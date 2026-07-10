import './auth-modal.css'
import { auth } from './utils/auth.js'

const pagePath = 'M90,0 L90,120 L11,120 C4.92486775,120 0,115.075132 0,109 L0,11 C0,4.92486775 4.92486775,0 11,0 L90,0 Z M71.5,81 L18.5,81 C17.1192881,81 16,82.1192881 16,83.5 C16,84.8254834 17.0315359,85.9100387 18.3356243,85.9946823 L18.5,86 L71.5,86 C72.8807119,86 74,84.8807119 74,83.5 C74,82.1745166 72.9684641,81.0899613 71.6643757,81.0053177 L71.5,81 Z M71.5,57 L18.5,57 C17.1192881,57 16,58.1192881 16,59.5 C16,60.8254834 17.0315359,61.9100387 18.3356243,61.9946823 L18.5,62 L71.5,62 C72.8807119,62 74,60.8807119 74,59.5 C74,58.1192881 72.8807119,57 71.5,57 Z M71.5,33 L18.5,33 C17.1192881,33 16,34.1192881 16,35.5 C16,36.8254834 17.0315359,37.9100387 18.3356243,37.9946823 L18.5,38 L71.5,38 C72.8807119,38 74,36.8807119 74,35.5 C74,34.1192881 72.8807119,33 71.5,33 Z'

export function initAuthModal({
  redirectOnAuthenticated = '',
  redirectAfterAuth = '',
  passwordResetRedirect = '/',
  signUpRedirect = '',
  defaultMode = 'login',
  autoOpen = false,
} = {}) {
  let mode = defaultMode
  let transitionStage = 'idle'
  const initialAuthUrl = new URL(window.location.href)
  const initialAuthHash = new URLSearchParams(initialAuthUrl.hash.slice(1))

  document.addEventListener('DOMContentLoaded', () => {
    const modal = ensureAuthModal()
    renderAuthModal(modal)

    window.__MIXING_AUTH_MODAL__ = true
    window.openMixingAuth = openAuth

    document.getElementById('open-auth-login')?.addEventListener('click', () => openAuth('login'))
    document.getElementById('open-auth-register')?.addEventListener('click', () => openAuth('register'))
    document.getElementById('auth-close')?.addEventListener('click', closeAuth)
    modal.addEventListener('click', event => {
      if (event.target === modal) closeAuth()
    })
    document.getElementById('auth-login-tab')?.addEventListener('click', () => setMode('login'))
    document.getElementById('auth-register-tab')?.addEventListener('click', () => setMode('register'))
    document.getElementById('auth-form')?.addEventListener('submit', submitAuth)
    document.getElementById('reset-form')?.addEventListener('submit', saveNewPassword)
    document.getElementById('auth-password-reset-request')?.addEventListener('click', requestPasswordReset)
    document.getElementById('reset-back-login')?.addEventListener('click', () => setMode('login'))
    document.getElementById('auth-password-toggle')?.addEventListener('click', event => togglePasswordVisibility(event, 'auth-password'))
    document.getElementById('reset-password-toggle')?.addEventListener('click', event => togglePasswordVisibility(event, 'reset-password'))

    window.addEventListener('mixing:open-auth', event => openAuth(event.detail?.mode || 'login'))
    if (window.location.hash === '#login') openAuth('login')
    if (window.location.hash === '#register') openAuth('register')
    if (isPasswordRecoveryUrl()) openAuth('reset')
    if (redirectOnAuthenticated || autoOpen) checkInitialAuth()
    auth.onAuthStateChange(event => {
      if (event === 'PASSWORD_RECOVERY') openAuth('reset')
    })
  })

  async function checkInitialAuth() {
    const user = await auth.getUser()
    if (user && redirectOnAuthenticated) {
      window.location.replace(redirectOnAuthenticated)
      return
    }
    if (!user && autoOpen && !isPasswordRecoveryUrl() && window.location.hash !== '#register') {
      openAuth(defaultMode)
    }
  }

  function openAuth(nextMode = 'login') {
    setMode(nextMode)
    const modal = ensureAuthModal()
    modal.classList.add('open')
    modal.setAttribute('aria-hidden', 'false')
    window.setTimeout(() => {
      document.getElementById(nextMode === 'reset' ? 'reset-password' : 'auth-email')?.focus()
    }, 0)
  }

  function closeAuth() {
    if (transitionStage !== 'idle') return
    const modal = document.getElementById('auth-modal')
    modal?.classList.remove('open')
    modal?.setAttribute('aria-hidden', 'true')
  }

  function setMode(nextMode) {
    mode = nextMode === 'register' || nextMode === 'reset' ? nextMode : 'login'
    const isRegister = mode === 'register'
    const isReset = mode === 'reset'
    const wrapper = document.querySelector('#auth-modal .lac-auth-wrapper')
    const title = document.getElementById('auth-title')
    const authForm = document.getElementById('auth-form')
    const resetForm = document.getElementById('reset-form')
    const nameField = document.getElementById('auth-name-field')
    const passwordField = document.getElementById('auth-password')
    const resetRequest = document.getElementById('auth-password-reset-request')
    const switchButton = document.querySelector('[data-switch-auth]')

    wrapper?.classList.toggle('login', !isRegister)
    wrapper?.classList.toggle('register', isRegister)
    wrapper?.classList.toggle('reset', isReset)
    document.getElementById('auth-login-tab')?.classList.toggle('active', !isRegister && !isReset)
    document.getElementById('auth-register-tab')?.classList.toggle('active', isRegister)
    if (title) title.textContent = isReset ? 'RESET' : isRegister ? 'REGISTER' : 'LOGIN'
    if (authForm) authForm.style.display = isReset ? 'none' : 'block'
    if (resetForm) resetForm.style.display = isReset ? 'block' : 'none'
    if (nameField) nameField.style.display = isRegister ? 'flex' : 'none'
    if (passwordField) passwordField.autocomplete = isRegister ? 'new-password' : 'current-password'
    if (resetRequest) resetRequest.style.display = isRegister || isReset ? 'none' : 'inline-block'
    if (switchButton) switchButton.textContent = isRegister ? 'Sign In' : 'Sign Up'
    const submitLabel = document.getElementById('auth-submit-label')
    if (submitLabel) submitLabel.textContent = isRegister ? 'Sign Up' : 'Sign In'
    setMessage('')
    setResetMessage('')
  }

  async function submitAuth(event) {
    event.preventDefault()
    const email = document.getElementById('auth-email')?.value.trim()
    const password = document.getElementById('auth-password')?.value
    const name = document.getElementById('auth-name')?.value.trim()

    if (!email || !password) return setMessage('Vui lòng nhập email và mật khẩu.', true)

    setControlsBusy(true)
    if (mode === 'login') setTransitionStage('loading')

    const minDelayPromise = mode === 'login'
      ? new Promise(resolve => window.setTimeout(resolve, 1800))
      : Promise.resolve()

    const displayName = name || email.split('@')[0]
    const result = mode === 'register'
      ? await auth.signUp(
          email,
          password,
          { display_name: displayName, full_name: displayName },
          signUpRedirect ? { emailRedirectTo: new URL(signUpRedirect, window.location.origin).toString() } : {}
        )
      : await auth.signIn(email, password)

    if (result.error) {
      setTransitionStage('idle')
      setControlsBusy(false)
      return setMessage(result.error.message, true)
    }

    if (mode === 'register' && !result.session) {
      setControlsBusy(false)
      return setMessage('Đăng ký thành công. Vui lòng kiểm tra email để xác nhận tài khoản.', false, true)
    }

    if (mode === 'register') {
      setControlsBusy(false)
      setMessage('Đăng ký thành công.', false, true)
      return
    }

    await minDelayPromise
    setTransitionStage('expanding')
    window.setTimeout(() => {
      setControlsBusy(false)
      setTransitionStage('idle')
      if (redirectAfterAuth) {
        window.location.replace(redirectAfterAuth)
      } else {
        closeAuth()
      }
    }, 850)
  }

  async function requestPasswordReset() {
    const email = document.getElementById('auth-email')?.value.trim()
    const button = document.getElementById('auth-password-reset-request')
    if (!email) {
      setMessage('Nhập email trước khi yêu cầu đặt lại mật khẩu.', true)
      document.getElementById('auth-email')?.focus()
      return
    }

    button.disabled = true
    button.textContent = 'Đang gửi...'
    const redirectUrl = new URL(window.location.origin + passwordResetRedirect)
    redirectUrl.searchParams.set('recovery', '1')
    const { error } = await auth.resetPassword(email, redirectUrl.toString())
    button.disabled = false
    button.textContent = 'Quên mật khẩu?'

    if (error) return setMessage(error.message || 'Không thể gửi email đặt lại mật khẩu.', true)
    setMessage('Đã gửi liên kết đặt lại mật khẩu. Vui lòng kiểm tra email và thư rác.', false, true)
  }

  async function saveNewPassword(event) {
    event.preventDefault()
    const password = document.getElementById('reset-password')?.value || ''
    const confirmation = document.getElementById('reset-confirm-password')?.value || ''

    if (password.length < 8) return setResetMessage('Mật khẩu cần có ít nhất 8 ký tự.', true)
    if (password !== confirmation) return setResetMessage('Hai mật khẩu chưa trùng khớp.', true)

    setControlsBusy(true)
    const { error } = await auth.updatePassword(password)
    setControlsBusy(false)

    if (error) return setResetMessage(error.message || 'Không thể cập nhật mật khẩu.', true)
    cleanRecoveryUrl()
    setResetMessage('Đã cập nhật mật khẩu. Bạn có thể đăng nhập bằng mật khẩu mới.', false, true)
    window.setTimeout(() => setMode('login'), 900)
  }

  function setTransitionStage(nextStage) {
    transitionStage = nextStage
    const wrapper = document.querySelector('#auth-modal .lac-auth-wrapper')
    wrapper?.classList.toggle('stage-loading', nextStage !== 'idle')
    wrapper?.classList.toggle('stage-expand', nextStage === 'expanding')
  }

  function setControlsBusy(isBusy) {
    document.querySelectorAll('#auth-modal input, #auth-modal button').forEach(element => {
      if (element.id !== 'auth-close') element.disabled = isBusy
    })
    const submitLabel = document.getElementById('auth-submit-label')
    if (submitLabel) {
      submitLabel.textContent = isBusy
        ? mode === 'register' ? 'Đang tạo...' : 'Đang đăng nhập...'
        : mode === 'register' ? 'Sign Up' : 'Sign In'
    }
    const resetSubmitLabel = document.getElementById('reset-submit-label')
    if (resetSubmitLabel) resetSubmitLabel.textContent = isBusy ? 'Đang lưu...' : 'Lưu mật khẩu mới'
  }

  function togglePasswordVisibility(event, inputId) {
    const input = document.getElementById(inputId)
    const button = event.currentTarget
    if (!input || !button) return
    const showing = input.type === 'text'
    input.type = showing ? 'password' : 'text'
    button.innerHTML = `<i class="fa-regular fa-${showing ? 'eye' : 'eye-slash'}"></i>`
    button.setAttribute('aria-label', showing ? 'Hiện mật khẩu' : 'Ẩn mật khẩu')
  }

  function setMessage(message, isError = false, isSuccess = false) {
    const el = document.getElementById('auth-message')
    if (!el) return
    el.textContent = message
    el.classList.toggle('error', isError)
    el.classList.toggle('success', isSuccess)
  }

  function setResetMessage(message, isError = false, isSuccess = false) {
    const el = document.getElementById('reset-message')
    if (!el) return
    el.textContent = message
    el.classList.toggle('error', isError)
    el.classList.toggle('success', isSuccess)
  }

  function isPasswordRecoveryUrl() {
    return initialAuthUrl.searchParams.get('recovery') === '1'
      || initialAuthUrl.searchParams.get('type') === 'recovery'
      || initialAuthHash.get('type') === 'recovery'
  }

  function cleanRecoveryUrl() {
    const cleanUrl = new URL(window.location.href)
    cleanUrl.searchParams.delete('recovery')
    cleanUrl.searchParams.delete('type')
    cleanUrl.searchParams.delete('code')
    cleanUrl.hash = ''
    history.replaceState({}, '', `${cleanUrl.pathname}${cleanUrl.search}`)
  }
}

function ensureAuthModal() {
  let modal = document.getElementById('auth-modal')
  if (!modal) {
    modal = document.createElement('div')
    modal.id = 'auth-modal'
    document.body.appendChild(modal)
  }
  modal.className = 'vip-modal'
  modal.setAttribute('aria-hidden', 'true')
  return modal
}

function renderAuthModal(modal) {
  modal.innerHTML = `
    <section class="lac-auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title">
      <button class="lac-auth-close" id="auth-close" type="button" aria-label="Đóng">&times;</button>
      <div class="lac-auth-wrapper login">
        <div class="lac-login-card">
          <div class="lac-bg-svg-container login">
            ${loginCloudSvg()}
            ${registerCloudSvg()}
          </div>
          <div class="lac-brand-logo-container login">
            <img src="/lachong-auth-logo.png" alt="Lac Hong University" class="lac-brand-logo-img" />
          </div>
          <div class="lac-form-container login">
            <h1 id="auth-title">LOGIN</h1>
            <div class="lac-tabs" role="tablist">
              <button id="auth-login-tab" class="active" type="button">Sign In</button>
              <button id="auth-register-tab" type="button">Sign Up</button>
            </div>
            <form id="auth-form">
              <div class="lac-input-box" id="auth-name-field" style="display:none">
                <i class="fa-regular fa-user"></i>
                <input id="auth-name" type="text" autocomplete="name" maxlength="80" placeholder="Username" />
              </div>
              <div class="lac-input-box">
                <i class="fa-regular fa-envelope"></i>
                <input id="auth-email" type="email" autocomplete="email" placeholder="Email" required />
              </div>
              <div class="lac-input-box">
                <i class="fa-solid fa-lock"></i>
                <input id="auth-password" type="password" autocomplete="current-password" minlength="8" placeholder="Password" required />
                <button class="lac-password-toggle" id="auth-password-toggle" type="button" aria-label="Hiện mật khẩu"><i class="fa-regular fa-eye"></i></button>
              </div>
              <label class="lac-remember-row">
                <input type="checkbox" checked />
                <span>Remember me</span>
              </label>
              <p class="lac-message" id="auth-message" role="alert"></p>
              <button class="lac-btn lac-btn-signin" id="auth-submit" type="submit"><span id="auth-submit-label">Sign In</span></button>
              <button class="lac-forgot-password-link" id="auth-password-reset-request" type="button">Quên mật khẩu?</button>
            </form>
            <form id="reset-form" style="display:none">
              <div class="lac-input-box">
                <i class="fa-solid fa-lock"></i>
                <input id="reset-password" type="password" autocomplete="new-password" minlength="8" placeholder="Mật khẩu mới" required />
                <button class="lac-password-toggle" id="reset-password-toggle" type="button" aria-label="Hiện mật khẩu"><i class="fa-regular fa-eye"></i></button>
              </div>
              <div class="lac-input-box">
                <i class="fa-solid fa-shield-halved"></i>
                <input id="reset-confirm-password" type="password" autocomplete="new-password" minlength="8" placeholder="Nhập lại mật khẩu" required />
              </div>
              <p class="lac-message" id="reset-message" role="alert"></p>
              <button class="lac-btn lac-btn-signin" id="reset-submit" type="submit"><span id="reset-submit-label">Lưu mật khẩu mới</span></button>
              <button class="lac-forgot-password-link" id="reset-back-login" type="button">Quay lại đăng nhập</button>
            </form>
            <div class="lac-or-divider"><span>Or</span></div>
            <button class="lac-btn lac-btn-signup" type="button" data-switch-auth>Sign Up</button>
          </div>
        </div>
        <div class="lac-loading-overlay">
          ${bookLoaderMarkup()}
        </div>
      </div>
    </section>
  `
  modal.querySelector('[data-switch-auth]')?.addEventListener('click', () => {
    const wrapper = modal.querySelector('.lac-auth-wrapper')
    window.openMixingAuth?.(wrapper?.classList.contains('register') ? 'login' : 'register')
  })
}

function bookLoaderMarkup() {
  const pages = Array.from({ length: 5 }, () => `
    <li>
      <svg fill="currentColor" viewBox="0 0 90 120">
        <path d="${pagePath}" />
      </svg>
    </li>
  `).join('')

  return `
    <div class="lac-loader">
      <div class="book-body"><ul>${pages}</ul></div>
      <span>Loading...</span>
    </div>
  `
}

function loginCloudSvg() {
  return `
    <svg class="lac-bg-svg-item" viewBox="0 0 1000 562" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="white-cloud-shadow-shared" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="-8" dy="6" stdDeviation="8" floodOpacity="0.3"/></filter>
        <filter id="blue-cloud-shadow-shared" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="6" dy="6" stdDeviation="9" floodOpacity="0.25"/></filter>
      </defs>
      <rect width="1000" height="562" fill="#164877"/>
      <g class="blue-layer" filter="url(#blue-cloud-shadow-shared)" fill="#113659"><circle cx="100" cy="20" r="140" /><circle cx="260" cy="-10" r="120" /><circle cx="380" cy="-40" r="100" /></g>
      <g class="blue-layer" filter="url(#blue-cloud-shadow-shared)" fill="#133f67"><circle cx="50" cy="60" r="130" /><circle cx="190" cy="40" r="120" /><circle cx="320" cy="10" r="110" /></g>
      <g class="blue-layer" filter="url(#blue-cloud-shadow-shared)" fill="#184e82"><circle cx="-20" cy="420" r="150" /><circle cx="120" cy="490" r="140" /><circle cx="280" cy="540" r="120" /></g>
      <g class="blue-layer" filter="url(#blue-cloud-shadow-shared)" fill="#1b568f"><circle cx="60" cy="510" r="130" /><circle cx="210" cy="560" r="120" /></g>
      <g class="white-layer" filter="url(#white-cloud-shadow-shared)" fill="#ffffff">
        <polygon points="1000,0 720,0 620,150 530,290 420,470 420,562 1000,562" />
        <circle cx="720" cy="30" r="90" /><circle cx="620" cy="150" r="100" /><circle cx="530" cy="290" r="120" /><circle cx="420" cy="470" r="160" />
      </g>
    </svg>
  `
}

function registerCloudSvg() {
  return `
    <svg class="lac-bg-svg-item" viewBox="0 0 1000 562" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="white-cloud-shadow-reg-shared" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="8" dy="6" stdDeviation="8" floodOpacity="0.3"/></filter>
        <filter id="blue-cloud-shadow-reg-shared" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="-6" dy="6" stdDeviation="9" floodOpacity="0.25"/></filter>
      </defs>
      <rect width="1000" height="562" fill="#164877"/>
      <g class="blue-layer" filter="url(#blue-cloud-shadow-reg-shared)" fill="#113659"><circle cx="900" cy="20" r="140" /><circle cx="740" cy="-10" r="120" /><circle cx="620" cy="-40" r="100" /></g>
      <g class="blue-layer" filter="url(#blue-cloud-shadow-reg-shared)" fill="#133f67"><circle cx="950" cy="60" r="130" /><circle cx="810" cy="40" r="120" /><circle cx="680" cy="10" r="110" /></g>
      <g class="blue-layer" filter="url(#blue-cloud-shadow-reg-shared)" fill="#184e82"><circle cx="1020" cy="420" r="150" /><circle cx="880" cy="490" r="140" /><circle cx="740" cy="540" r="120" /></g>
      <g class="blue-layer" filter="url(#blue-cloud-shadow-reg-shared)" fill="#1b568f"><circle cx="940" cy="510" r="130" /><circle cx="810" cy="560" r="120" /></g>
      <g class="white-layer" filter="url(#white-cloud-shadow-reg-shared)" fill="#ffffff">
        <polygon points="0,0 280,0 380,150 470,290 580,470 580,562 0,562" />
        <circle cx="280" cy="30" r="90" /><circle cx="380" cy="150" r="100" /><circle cx="470" cy="290" r="120" /><circle cx="580" cy="470" r="160" />
      </g>
    </svg>
  `
}
