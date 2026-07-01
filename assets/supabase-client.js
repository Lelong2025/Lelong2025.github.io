// assets/supabase-client.js
// Shared Supabase client + session helpers
// Import qua ESM CDN — không cần build step
//
// ⚠️  Sau khi rotate keys trong Supabase Dashboard, thay SUPABASE_PUBLISHABLE_KEY
// bằng publishable key MỚI (lấy từ https://supabase.com/dashboard/project/duycstnptwojisioeosk/settings/api)
// Publishable key an toàn để hardcode (đó là mục đích của nó).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.109.0';

const SUPABASE_URL = 'https://duycstnptwojisioeosk.supabase.co';

// TODO: Paste publishable key MỚI vào đây (sau khi rotate)
const SUPABASE_PUBLISHABLE_KEY = '<PASTE_NEW_PUBLISHABLE_KEY_HERE>';

if (SUPABASE_PUBLISHABLE_KEY.startsWith('<')) {
  console.warn('[supabase-client] SUPABASE_PUBLISHABLE_KEY chưa được set. ' +
    'Edit assets/supabase-client.js và paste key mới.');
}

export const db = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: window.localStorage
  }
});

export async function getSession() {
  const { data: { session } } = await db.auth.getSession();
  return session;
}

export async function getUser() {
  const session = await getSession();
  return session?.user ?? null;
}

export async function getIsAdmin() {
  const user = await getUser();
  return user?.app_metadata?.is_admin === true;
}
