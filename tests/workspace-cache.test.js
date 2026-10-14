import assert from 'node:assert/strict';
import test from 'node:test';
import { LOCAL_STATE_KEY, readWorkspaceCache, writeWorkspaceCache } from '../src/magazine/modules/workspace-cache.js';
import { state, saveToLocalStorage } from '../src/magazine/modules/state.js';

const disk = new Map();
const legacy = new Map();
let databaseUnavailable = false;
let storageFull = false;
globalThis.localStorage = {
    getItem: key => legacy.get(key) || null,
    removeItem: key => legacy.delete(key),
    setItem(key, value) {
        if (storageFull) throw new DOMException('Storage full', 'QuotaExceededError');
        legacy.set(key, value);
    }
};
globalThis.indexedDB = {
    open() {
        const request = {};
        queueMicrotask(() => {
            if (databaseUnavailable) {
                request.error = new Error('IndexedDB unavailable');
                request.onerror();
                return;
            }
            request.result = {
                close() {},
                transaction() {
                    const transaction = {
                        objectStore: () => ({
                            get: key => execute(() => disk.get(key)),
                            put: (value, key) => execute(() => { disk.set(key, value); return key; })
                        })
                    };
                    function execute(action) {
                        const result = {};
                        queueMicrotask(() => { result.result = action(); transaction.oncomplete(); });
                        return result;
                    }
                    return transaction;
                }
            };
            request.onsuccess();
        });
        return request;
    }
};
globalThis.document = { getElementById: () => null };

test('large admin workspace survives localStorage quota and restores all content', async () => {
    storageFull = true;
    const workspace = { issues: { admin: { bodyContent: 'x'.repeat(6 * 1024 * 1024) } } };
    legacy.set(LOCAL_STATE_KEY, JSON.stringify({ issues: {} }));
    assert.equal(await writeWorkspaceCache(workspace), true);
    assert.deepEqual(await readWorkspaceCache(), workspace);
    assert.equal(legacy.has(LOCAL_STATE_KEY), false);
});

test('reads legacy cache when IndexedDB is unavailable', async () => {
    databaseUnavailable = true;
    const workspace = { issues: { legacy: { articles: [] } } };
    legacy.set(LOCAL_STATE_KEY, JSON.stringify(workspace));
    assert.deepEqual(await readWorkspaceCache(), workspace);
});

test('uses localStorage fallback and selects it over an older IndexedDB backup', async () => {
    storageFull = false;
    const workspace = { issues: { latest: { articles: [] } } };
    assert.equal(await writeWorkspaceCache(workspace), true);
    databaseUnavailable = false;
    assert.deepEqual(await readWorkspaceCache(), workspace);
});

test('failed local backup still schedules and performs cloud save', async () => {
    databaseUnavailable = true;
    storageFull = true;
    state.cloudUser = { id: 'admin' };
    state.cloudSyncEnabled = true;
    let saved;
    globalThis.window = { lhuSupabase: { from: () => ({ upsert: async payload => { saved = payload; return { error: null }; } }) } };
    const originalTimeout = globalThis.setTimeout;
    let callback;
    globalThis.setTimeout = handler => { callback = handler; return 1; };
    try {
        assert.doesNotThrow(() => saveToLocalStorage());
        await callback();
        await readWorkspaceCache();
        assert.equal(saved.user_id, 'admin');
        assert.deepEqual(saved.state, state.appState);
        assert.equal(state.localBackupAvailable, false);
    } finally {
        globalThis.setTimeout = originalTimeout;
    }
});

test('queued edits preserve the latest snapshot', async () => {
    databaseUnavailable = false;
    const older = { issues: {}, currentArticleId: 'older' };
    const latest = { issues: {}, currentArticleId: 'latest' };
    await Promise.all([writeWorkspaceCache(older), writeWorkspaceCache(latest)]);
    assert.deepEqual(await readWorkspaceCache(), latest);
});
