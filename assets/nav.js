// assets/nav.js
// Render header nav links theo session state (Tài khoản / Quản trị / Đăng xuất)
// Mỗi page cần có <div id="accountNavLinks"></div> trong header.

import { getUser, getIsAdmin, db } from './supabase-client.js';

async function renderNavLinks() {
  const navContainer = document.getElementById('accountNavLinks');
  if (!navContainer) return;

  const user = await getUser();
  const isAdmin = await getIsAdmin();

  if (user) {
    navContainer.innerHTML = `
      <a href="/account.html" class="nav-link" title="Tài khoản của bạn">
        <i class="fas fa-user"></i> Tài khoản
      </a>
      ${isAdmin ? '<a href="/admin.html" class="nav-link nav-link-admin" title="Trang quản trị"><i class="fas fa-shield-alt"></i> Quản trị</a>' : ''}
      <button class="nav-link nav-link-logout" onclick="handleNavLogout()" title="Đăng xuất">
        <i class="fas fa-sign-out-alt"></i> Đăng xuất
      </button>
    `;
  } else {
    navContainer.innerHTML = `
      <button class="nav-link" onclick="handleNavLogin()" title="Đăng nhập / Đăng ký">
        <i class="fas fa-sign-in-alt"></i> Đăng nhập
      </button>
    `;
  }
}

window.handleNavLogin = function () {
  // Trên index.html: mở login modal có sẵn. Trên page khác: redirect về home + mở modal.
  if (typeof window.openUserModal === 'function') {
    window.openUserModal();
  } else {
    location.href = '/?login=1';
  }
};

window.handleNavLogout = async function () {
  try {
    await db.auth.signOut();
  } catch (err) {
    console.error('Logout error:', err);
  }
  location.href = '/';
};

// Re-render khi auth state đổi
db.auth.onAuthStateChange(() => {
  renderNavLinks();
});

// Initial render
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', renderNavLinks);
} else {
  renderNavLinks();
}
