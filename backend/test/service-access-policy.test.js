import assert from 'node:assert/strict';
import test from 'node:test';
import api, { handleAdminSettings, handleMagazineReview, handleReserveUsage } from '../src/index.js';
import { loadServiceProducts } from '../src/service-access-policy.js';

const cors = { headers: {}, originAllowed: true };
const request = body => new Request('https://example.test/api/test', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});

function mockDatabase({ requiresPlan = false, active = true, missingColumn = false, allowed = false } = {}) {
  const calls = [];
  const products = ['magazine_export', 'magazine_ai_review'].map(code => ({ code, active, requires_plan: requiresPlan, trial_days: 14 }));
  return {
    calls,
    from(table) {
      const call = { table, filters: {}, operation: 'read' };
      calls.push(call);
      const query = {
        select(fields) { call.fields = fields; return query; },
        eq(key, value) { call.filters[key] = value; return query; },
        order() { return query; }, limit() { return query; },
        update(values) { call.operation = 'update'; call.values = values; return query; },
        maybeSingle() { call.single = true; return query; },
        then(resolve, reject) {
          if (missingColumn && (call.fields?.includes('requires_plan') || Object.hasOwn(call.values || {}, 'requires_plan'))) {
            return Promise.resolve({ data: null, error: { code: '42703', message: 'column requires_plan does not exist' } }).then(resolve, reject);
          }
          assert.equal(table, 'service_products', 'Free mode must not read entitlements or usage');
          if (call.operation === 'update') {
            Object.assign(products.find(row => row.code === call.filters.code), call.values);
          }
          let data = products.filter(row => Object.entries(call.filters).every(([key, value]) => row[key] === value));
          if (missingColumn) data = data.map(({ requires_plan, ...row }) => row);
          return Promise.resolve({ data: call.single ? data[0] || null : data, error: null }).then(resolve, reject);
        }
      };
      return query;
    },
    async rpc(name, args) {
      calls.push({ rpc: name, args });
      return { data: { allowed, reason: 'plan_required', ...(allowed ? { reservation_id: 'paid-reservation' } : {}) }, error: null };
    }
  };
}
const context = (db, role = 'client') => ({ supabaseAdmin: db, userClaims: { id: 'user-1', role } });

for (const code of ['magazine_export', 'magazine_ai_review']) {
  test(`${code}: free access requires no entitlement and makes no reservation`, async () => {
    const db = mockDatabase();
    const response = await handleReserveUsage(request({ product_code: code, idempotency_key: 'unique' }), {}, context(db), cors);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { allowed: true, unlimited: true, source: 'free' });
    assert.equal(db.calls.some(call => call.rpc), false);
  });
}

for (const options of [{ requiresPlan: true }, { active: false }, { missingColumn: true }]) {
  test(`paid gate retained: ${JSON.stringify(options)}`, async () => {
    const db = mockDatabase(options);
    const response = await handleReserveUsage(request({ product_code: 'magazine_export', idempotency_key: 'unique', unlimited: true, source: 'free' }), {}, context(db), cors);
    assert.equal(response.status, 403);
    assert.equal(db.calls.filter(call => call.rpc === 'reserve_service_usage').length, 1);
  });
}

test('free AI review ignores supplied reservation and never deducts/finalizes usage', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ choices: [{ message: { content: '{"ok":true}' } }] });
  try {
    for (const reservation of [undefined, 'untrusted-reservation']) {
      const db = mockDatabase();
      const response = await handleMagazineReview(request({ prompt: 'Review this article', usage_reservation_id: reservation }), {}, context(db), cors);
      assert.equal(response.status, 200);
      assert.equal(db.calls.some(call => call.rpc || call.table !== 'service_products'), false);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('paid AI review still reserves and rejects without access', async () => {
  const db = mockDatabase({ requiresPlan: true });
  const response = await handleMagazineReview(request({ prompt: 'Review', source: 'free' }), {}, context(db), cors);
  assert.equal(response.status, 403);
  assert.equal(db.calls.filter(call => call.rpc === 'reserve_service_usage').length, 1);
});

test('paid AI review success retains reservation and finalization', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ choices: [{ message: { content: '{}' } }] });
  try {
    const db = mockDatabase({ requiresPlan: true, allowed: true });
    const response = await handleMagazineReview(request({ prompt: 'Review' }), {}, context(db), cors);
    assert.equal(response.status, 200);
    assert.deepEqual(db.calls.filter(call => call.rpc).map(call => call.rpc), ['reserve_service_usage', 'finalize_service_usage']);
    assert.equal(db.calls.find(call => call.rpc === 'finalize_service_usage').args.p_success, true);
  } finally { globalThis.fetch = originalFetch; }
});

test('admin AI review remains unlimited without policy or entitlement lookup', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ choices: [{ message: { content: '{}' } }] });
  try {
    const db = mockDatabase({ requiresPlan: true });
    const response = await handleMagazineReview(request({ prompt: 'Review' }), {}, context(db, 'admin'), cors);
    assert.equal(response.status, 200);
    assert.equal(db.calls.length, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('AI route still requires authentication', async () => {
  const response = await api.fetch(new Request('https://example.test/api/magazine/review', {
    method: 'POST', headers: { Origin: 'http://localhost:5173' }
  }), {});
  assert.equal(response.status, 401);
});

test('non-admin cannot change policy', async () => {
  const db = mockDatabase();
  const response = await handleAdminSettings(request({ service_access: { magazine_export: false } }), {}, context(db), cors);
  assert.equal(response.status, 403);
  assert.equal(db.calls.length, 0);
});

test('policy-only changes persist flags and preserve trial settings', async () => {
  const db = mockDatabase({ requiresPlan: true });
  const response = await handleAdminSettings(request({ service_access: { magazine_export: false, magazine_ai_review: true } }), {}, context(db, 'admin'), cors);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.synced_trials, 0);
  assert.equal(body.products[0].requires_plan, false);
  assert.equal(body.products[1].requires_plan, true);
  assert.equal(body.products[0].trial_days, 14);
  assert.equal(db.calls.filter(call => call.operation === 'update').every(call => !Object.hasOwn(call.values, 'trial_days')), true);
});

for (const body of [{}, { service_access: {} }, { service_access: { magazine_export: 'false' } }, { service_access: { chatbox_ai: false } }, { trial_days: 10 }, { service_access: { magazine_export: false }, trial_enabled: false }]) {
  test(`invalid settings never mutate database: ${JSON.stringify(body)}`, async () => {
    const db = mockDatabase();
    const response = await handleAdminSettings(request(body), {}, context(db, 'admin'), cors);
    assert.equal(response.status, 400);
    assert.equal(db.calls.length, 0);
  });
}

test('saving without migration reports clear migration requirement before mutating', async () => {
  const db = mockDatabase({ missingColumn: true });
  const response = await handleAdminSettings(request({ service_access: { magazine_export: false } }), {}, context(db, 'admin'), cors);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'migration_required');
  assert.equal(db.calls.some(call => call.operation === 'update'), false);
});

test('product list defaults to paid-safe before migration', async () => {
  const result = await loadServiceProducts(mockDatabase({ missingColumn: true }));
  assert.equal(result.error, null);
  assert.equal(result.data.every(product => product.requires_plan === true), true);
});
