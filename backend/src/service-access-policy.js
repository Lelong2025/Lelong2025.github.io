export const MAGAZINE_SERVICE_CODES = ['magazine_export', 'magazine_ai_review'];

export function isPolicyColumnMissing(error) {
  const message = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
  return message.includes('requires_plan') &&
    (error?.code === '42703' || error?.code === 'PGRST204' || message.includes('column') || message.includes('schema cache'));
}

export function normalizeServiceProduct(product) {
  return { ...product, requires_plan: product.requires_plan !== false };
}

export async function loadServiceProducts(admin, activeOnly = false) {
  const query = (withPolicy) => {
    let result = admin.from('service_products').select(`code, name, description, trial_days, trial_daily_limit, active${withPolicy ? ', requires_plan' : ''}`);
    if (activeOnly) result = result.eq('active', true);
    return result.order('created_at');
  };
  let result = await query(true);
  if (isPolicyColumnMissing(result.error)) result = await query(false);
  return { ...result, data: result.data?.map(normalizeServiceProduct) };
}

export async function hasFreeMagazineAccess(admin, productCode) {
  if (!MAGAZINE_SERVICE_CODES.includes(productCode)) return false;
  const { data, error } = await admin.from('service_products')
    .select('code, active, requires_plan').eq('code', productCode).maybeSingle();
  // Until the migration is applied, preserve the existing paid access rules.
  if (isPolicyColumnMissing(error)) return false;
  if (error) throw error;
  return data?.active === true && data.requires_plan === false;
}

export function validServiceAccessInput(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length > 0
    && Object.entries(value).every(([code, enabled]) => MAGAZINE_SERVICE_CODES.includes(code) && typeof enabled === 'boolean');
}
