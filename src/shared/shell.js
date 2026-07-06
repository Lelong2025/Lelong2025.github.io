import './shell.css'
import { auth } from './utils/auth.js'
import { apiFetch } from './utils/api.js'

const ADMIN_NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', href: '/portal/?page=dashboard' },
  { id: 'tapchi', label: 'Tra cứu tạp chí', href: '/tapchi/' },
  { id: 'editor', label: 'Hệ thống soạn báo', href: '/magazine/editor.html' },
  { id: 'invoices', label: 'Quản lý hóa đơn', href: '/portal/?page=invoices' },
  { id: 'users', label: 'Người dùng', href: '/portal/?page=users' },
  { id: 'settings', label: 'Cài đặt', href: '/portal/?page=settings' },
]

const CLIENT_NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', href: '/portal/?page=dashboard' },
  { id: 'tapchi', label: 'Tra cứu', href: '/tapchi/' },
  { id: 'editor', label: 'Soạn báo', href: '/magazine/editor.html' },
  { id: 'payments', label: 'Lịch sử thanh toán', href: '/portal/?page=payments' },
]

const GUEST_NAV_ITEMS = [
  { id: 'tapchi', label: 'Tra cứu', href: '/tapchi/' },
  { id: 'editor', label: 'Soạn báo', href: '/magazine/editor.html' },
]

export async function initMixingShell({ active = inferActiveRoute(), showEditor = true } = {}) {
  if (document.getElementById('mixing-shell')) return

  document.body.classList.add('has-mixing-shell')
  applyStoredTheme()

  const backdrop = document.createElement('button')
  backdrop.className = 'mixing-shell-backdrop'
  backdrop.type = 'button'
  backdrop.dataset.shellAction = 'close-sidebar'
  backdrop.setAttribute('aria-label', 'Đóng menu')

  const sidebar = document.createElement('aside')
  sidebar.className = 'mixing-shell-sidebar'
  sidebar.id = 'mixing-shell-sidebar'
  sidebar.innerHTML = `
    <div class="mixing-shell-sidebar__brand-row">
      <span class="mixing-shell-sidebar__title">Menu</span>
    </div>
    <nav class="mixing-shell__nav" id="mixing-shell-nav" aria-label="Điều hướng hệ thống"></nav>
  `

  const header = document.createElement('header')
  header.className = 'mixing-shell'
  header.id = 'mixing-shell'
  header.innerHTML = `
    <div class="mixing-shell__top">
      <button class="mixing-shell__icon-btn mixing-shell__mobile-menu" type="button" data-shell-action="open-sidebar"
        aria-label="Mở menu" title="Mở menu">
        <i class="fa-solid fa-bars"></i>
      </button>
      <a class="mixing-shell__brand" href="/" aria-label="Editorial Portal">
        <span class="mixing-shell__logo"><i class="fa-solid fa-flask"></i></span>
        <span class="mixing-shell__brand-copy">
          <strong>Editorial Portal</strong>
          <small>Journal of Science LHU</small>
        </span>
      </a>

      <div class="mixing-shell__actions">
        <a class="mixing-shell__credits" href="/portal/?page=dashboard" aria-label="Mua thêm lượt" hidden>
          <i class="fa-solid fa-bolt"></i>
          <span>Mua thêm lượt</span>
        </a>
        <label class="theme-switch" id="mixing-shell-theme" aria-label="Chuyển giao diện sáng tối">
          <input type="checkbox" class="theme-switch__checkbox" id="mixing-shell-theme-checkbox">
          <div class="theme-switch__container">
            <div class="theme-switch__clouds"></div>
            <div class="theme-switch__stars-container">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 55" fill="none">
                <path fill-rule="evenodd" clip-rule="evenodd" d="M135.831 3.00688C135.055 3.85027 134.111 4.29946 133 4.35447C134.111 4.40947 135.055 4.85867 135.831 5.71123C136.607 6.55462 136.996 7.56303 136.996 8.72727C136.996 7.95722 137.172 7.25134 137.525 6.59129C137.886 5.93124 138.372 5.39954 138.98 5.00535C139.598 4.60199 140.268 4.39114 141 4.35447C139.88 4.2903 138.936 3.85027 138.16 3.00688C137.384 2.16348 136.996 1.16425 136.996 0C136.996 1.16425 136.607 2.16348 135.831 3.00688ZM31 23.3545C32.1114 23.2995 33.0551 22.8503 33.8313 22.0069C34.6075 21.1635 34.9956 20.1642 34.9956 19C34.9956 20.1642 35.3837 21.1635 36.1599 22.0069C36.9361 22.8503 37.8798 23.2903 39 23.3545C38.2679 23.3911 37.5976 23.602 36.9802 24.0053C36.3716 24.3995 35.8864 24.9312 35.5248 25.5913C35.172 26.2513 34.9956 26.9572 34.9956 27.7273C34.9956 26.563 34.6075 25.5546 33.8313 24.7112C33.0551 23.8587 32.1114 23.4095 31 23.3545ZM0 36.3545C1.11136 36.2995 2.05513 35.8503 2.83131 35.0069C3.6075 34.1635 3.99559 33.1642 3.99559 32C3.99559 33.1642 4.38368 34.1635 5.15987 35.0069C5.93605 35.8503 6.87982 36.2903 8 36.3545C7.26792 36.3911 6.59757 36.602 5.98015 37.0053C5.37155 37.3995 4.88644 37.9312 4.52481 38.5913C4.172 39.2513 3.99559 39.9572 3.99559 40.7273C3.99559 39.563 3.6075 38.5546 2.83131 37.7112C2.05513 36.8587 1.11136 36.4095 0 36.3545ZM56.8313 24.0069C56.0551 24.8503 55.1114 25.2995 54 25.3545C55.1114 25.4095 56.0551 25.8587 56.8313 26.7112C57.6075 27.5546 57.9956 28.563 57.9956 29.7273C57.9956 28.9572 58.172 28.2513 58.5248 27.5913C58.8864 26.9312 59.3716 26.3995 59.9802 26.0053C60.5976 25.602 61.2679 25.3911 62 25.3545C60.8798 25.2903 59.9361 24.8503 59.1599 24.0069C58.3837 23.1635 57.9956 22.1642 57.9956 21C57.9956 22.1642 57.6075 23.1635 56.8313 24.0069ZM81 25.3545C82.1114 25.2995 83.0551 24.8503 83.8313 24.0069C84.6075 23.1635 84.9956 22.1642 84.9956 21C84.9956 22.1642 85.3837 23.1635 86.1599 24.0069C86.9361 24.8503 87.8798 25.2903 89 25.3545C88.2679 25.3911 87.5976 25.602 86.9802 26.0053C86.3716 26.3995 85.8864 24.9312 85.5248 27.5913C85.172 28.2513 84.9956 28.9572 84.9956 29.7273C84.9956 28.563 84.6075 25.5546 83.8313 26.7112C83.0551 25.8587 82.1114 25.4095 81 25.3545ZM136 36.3545C137.111 36.2995 138.055 35.8503 138.831 35.0069C139.607 34.1635 139.996 33.1642 139.996 32C139.996 33.1642 140.384 34.1635 141.16 35.0069C141.936 35.8503 142.88 36.2903 144 36.3545C143.268 36.3911 142.598 36.602 141.98 37.0053C141.372 37.3995 140.886 37.9312 140.525 38.5913C140.172 39.2513 139.996 39.9572 139.996 40.7273C139.996 39.563 139.607 38.5546 138.831 37.7112C138.055 36.8587 137.111 36.4095 136 36.3545ZM101.831 49.0069C101.055 49.8503 100.111 50.2995 99 50.3545C100.111 50.4095 101.055 50.8587 101.831 51.7112C102.607 52.5546 102.996 53.563 102.996 54.7273C102.996 53.9572 103.172 53.2513 103.525 52.5913C103.886 51.9312 104.372 51.3995 104.98 51.0053C105.598 50.602 106.268 50.3911 107 50.3545C105.88 50.2903 104.936 49.8503 104.16 49.0069C103.384 48.1635 102.996 47.1642 102.996 46C102.996 47.1642 102.607 48.1635 101.831 49.0069Z" fill="currentColor"></path>
              </svg>
            </div>
            <div class="theme-switch__circle-container">
              <div class="theme-switch__sun-moon-container">
                <div class="theme-switch__moon">
                  <div class="theme-switch__spot"></div>
                  <div class="theme-switch__spot"></div>
                  <div class="theme-switch__spot"></div>
                </div>
              </div>
            </div>
          </div>
        </label>
        <div class="mixing-shell__account" id="mixing-shell-account"></div>
      </div>
    </div>
  `

  document.body.prepend(header)
  document.body.prepend(sidebar)
  document.body.prepend(backdrop)

  header.querySelector('#mixing-shell-theme-checkbox')?.addEventListener('change', toggleTheme)
  header.addEventListener('click', handleShellClick)
  sidebar.addEventListener('click', handleShellClick)
  backdrop.addEventListener('click', handleShellClick)
  document.addEventListener('click', event => {
    if (!header.contains(event.target)) closeAccountMenu(header)
  })
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeSidebarDrawer()
  })

  await updateShellUser(header, { active, showEditor })
  auth.onAuthStateChange(() => updateShellUser(header, { active, showEditor }))
}

async function updateShellUser(header, options = {}) {
  const accountEl = header.querySelector('#mixing-shell-account')
  const navEl = document.getElementById('mixing-shell-nav')
  const user = await auth.getUser()
  const account = user ? await loadAccount() : null
  const role = getUserRole(user, account)
  const isAdmin = role === 'admin'
  const active = options.active || inferActiveRoute()
  const navItems = user ? (isAdmin ? ADMIN_NAV_ITEMS : CLIENT_NAV_ITEMS) : GUEST_NAV_ITEMS
  const visibleItems = navItems.filter(item => options.showEditor !== false || item.id !== 'editor')
  header.querySelector('.mixing-shell__credits')?.toggleAttribute('hidden', !user)

  if (navEl) {
    navEl.innerHTML = visibleItems.map(item => `
      <a class="mixing-shell__link${item.href === '#' ? ' is-disabled' : ''}" href="${item.href}" data-shell-nav="${item.id}"
         aria-current="${item.id === active ? 'page' : 'false'}" title="${escapeHTML(item.label)}">
        <i class="fa-solid ${escapeHTML(getNavIcon(item.id))}"></i>
        <span>${escapeHTML(item.label)}</span>
      </a>
    `).join('')
  }

  if (user) {
    const name = getUserName(user)
    const subtitle = isAdmin ? 'System Administrator' : 'Thành viên'
    const avatar = getAvatarUrl(user)
    if (accountEl) {
      accountEl.innerHTML = `
        <button class="mixing-shell__profile" id="mixing-shell-profile" type="button" aria-haspopup="menu" aria-expanded="false">
          <span class="mixing-shell__identity">
            <strong>${escapeHTML(name)}</strong>
            <small>${escapeHTML(subtitle)}</small>
          </span>
          <span class="mixing-shell__avatar">
            ${avatar ? `<img src="${escapeHTML(avatar)}" alt="" />` : `<span>${escapeHTML(getInitial(name))}</span>`}
          </span>
          <i class="fa-solid fa-caret-down"></i>
        </button>
        <div class="mixing-shell__menu" id="mixing-shell-menu" role="menu">
          <button type="button" role="menuitem" data-shell-action="logout">
            <i class="fa-solid fa-right-from-bracket"></i>
            <span>Đăng xuất</span>
          </button>
        </div>
      `
    }
  } else if (accountEl) {
    accountEl.innerHTML = `
      <button class="mixing-shell__login" type="button" data-shell-action="login">
        <i class="fa-solid fa-right-to-bracket"></i>
        <span>Đăng nhập</span>
      </button>
    `
  }
}

async function loadAccount() {
  try {
    return await apiFetch('/api/account')
  } catch (_) {
    return null
  }
}

async function handleShellClick(event) {
  const header = document.getElementById('mixing-shell')
  const disabledLink = event.target.closest('.mixing-shell__link.is-disabled')
  if (disabledLink) {
    event.preventDefault()
    return
  }

  if (event.target.closest('.mixing-shell__link')) closeSidebarDrawer()

  const profile = event.target.closest('#mixing-shell-profile')
  if (profile) {
    const expanded = profile.getAttribute('aria-expanded') === 'true'
    profile.setAttribute('aria-expanded', String(!expanded))
    header.querySelector('#mixing-shell-menu')?.classList.toggle('open', !expanded)
    return
  }

  const action = event.target.closest('[data-shell-action]')?.dataset.shellAction
  if (action === 'open-sidebar') {
    openSidebarDrawer()
    return
  }
  if (action === 'close-sidebar') {
    closeSidebarDrawer()
    return
  }
  if (action === 'login') {
    openAuth()
    return
  }
  if (action === 'logout') {
    await auth.signOut()
    closeAccountMenu(header)
    await updateShellUser(header)
  }
}

function openAuth() {
  if (typeof window.openUserModal === 'function') {
    window.openUserModal(true)
    return
  }
  window.dispatchEvent(new CustomEvent('mixing:open-auth'))
  if (!window.__MIXING_AUTH_MODAL__) {
    window.location.href = window.location.pathname.startsWith('/magazine') ? '/magazine/' : '/#login'
  }
}

function closeAccountMenu(header) {
  header.querySelector('#mixing-shell-profile')?.setAttribute('aria-expanded', 'false')
  header.querySelector('#mixing-shell-menu')?.classList.remove('open')
}

function openSidebarDrawer() {
  document.body.classList.add('mixing-shell-nav-open')
}

function closeSidebarDrawer() {
  document.body.classList.remove('mixing-shell-nav-open')
}

function getNavIcon(id) {
  return ({
    dashboard: 'fa-chart-line',
    tapchi: 'fa-magnifying-glass',
    editor: 'fa-pen-nib',
    invoices: 'fa-file-invoice-dollar',
    users: 'fa-users',
    settings: 'fa-gear',
    payments: 'fa-clock-rotate-left',
  })[id] || 'fa-circle-dot'
}

function getUserRole(user, account) {
  return account?.role
    || user?.app_metadata?.role
    || user?.user_metadata?.role
    || 'client'
}

function getUserName(user) {
  return user?.user_metadata?.display_name
    || user?.user_metadata?.full_name
    || user?.email?.split('@')[0]
    || 'Người dùng'
}

function getAvatarUrl(user) {
  return user?.user_metadata?.avatar_url || user?.user_metadata?.picture || ''
}

function getInitial(name) {
  return String(name || 'U').trim().charAt(0).toUpperCase() || 'U'
}

function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]))
}

function applyStoredTheme() {
  const stored = normalizeTheme(localStorage.getItem('mixing-theme'))
    || normalizeTheme(localStorage.getItem('theme'))
    || normalizeTheme(document.documentElement.dataset.theme)
    || 'dark'
  document.documentElement.dataset.theme = stored
  localStorage.setItem('mixing-theme', stored)
  localStorage.setItem('theme', stored)
  syncThemeIcon()
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'
  document.documentElement.dataset.theme = next
  localStorage.setItem('mixing-theme', next)
  localStorage.setItem('theme', next)
  syncThemeIcon()
}

function normalizeTheme(value) {
  return value === 'light' || value === 'dark' ? value : ''
}

function syncThemeIcon() {
  const checkbox = document.getElementById('mixing-shell-theme-checkbox')
  if (checkbox) checkbox.checked = document.documentElement.dataset.theme === 'dark'
}

function inferActiveRoute() {
  const path = window.location.pathname
  if (path.startsWith('/portal')) return inferPortalActiveRoute()
  if (path.startsWith('/tapchi')) return 'tapchi'
  if (path.endsWith('/magazine/editor.html')) return 'editor'
  if (path.startsWith('/magazine')) return 'editor'
  return 'dashboard'
}

function inferPortalActiveRoute() {
  const page = new URLSearchParams(window.location.search).get('page')
  if (page === 'invoices') return 'invoices'
  if (page === 'users') return 'users'
  if (page === 'settings') return 'settings'
  if (page === 'payments') return 'payments'
  return 'dashboard'
}
