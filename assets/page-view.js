// assets/page-view.js
// Track page-view lên Supabase (chỉ cho index.html — page_views.page = 'home')
// Idempotent trong cùng ngày nhờ UNIQUE constraint trong DB.

import { db, getSession } from './supabase-client.js';

function getOrCreateVisitorId() {
  let vid = localStorage.getItem('vid');
  if (!vid) {
    vid = crypto.randomUUID();
    localStorage.setItem('vid', vid);
  }
  return vid;
}

export async function trackHomePageView() {
  try {
    const session = await getSession();
    // Nếu user đã login: dùng user.id (chính xác hơn — 1 người = 1 visitor bất kể device)
    // Nếu anon: dùng localStorage UUID
    const vid = session?.user?.id ?? getOrCreateVisitorId();
    await db.rpc('track_page_view', {
      p_visitor_id: vid,
      p_page: 'home'
    });
  } catch (err) {
    // Silent fail — không ảnh hưởng UX nếu tracking fail
    console.warn('[page-view] Tracking failed:', err?.message || err);
  }
}

// Auto-track khi load page
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', trackHomePageView);
} else {
  trackHomePageView();
}
