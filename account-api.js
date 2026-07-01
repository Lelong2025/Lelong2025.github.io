// account-api.js
// Wrapper cho Supabase RPC calls liên quan đến user account

import { db } from './assets/supabase-client.js';

/**
 * Lấy thông tin tài khoản của user hiện tại (1 RPC trả về tất cả)
 * @returns {Promise<{profile, subscription, plan, used_today, daily_limit}>}
 */
export async function getMyAccountInfo() {
  const { data, error } = await db.rpc('get_my_account_info');
  if (error) throw error;
  return data;
}
