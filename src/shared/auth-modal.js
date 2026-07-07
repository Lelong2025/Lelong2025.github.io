import './auth-modal.css'
import { auth } from './utils/auth.js'

export function initAuthModal({
  redirectOnAuthenticated = '',
  redirectAfterAuth = '',
  passwordResetRedirect = '/',
  signUpRedirect = '',
  defaultMode = 'login',
  autoOpen = false,
} = {}) {
  let mode = defaultMode
  const initialAuthUrl = new URL(window.location.href)
  const initialAuthHash = new URLSearchParams(initialAuthUrl.hash.slice(1))

  document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('auth-modal')
    const loginBtn = document.getElementById('open-auth-login')
    const registerBtn = document.getElementById('open-auth-register')
    const closeBtn = document.getElementById('auth-close')
    const loginTab = document.getElementById('auth-login-tab')
    const registerTab = document.getElementById('auth-register-tab')
    const form = document.getElementById('auth-form')
    const resetForm = document.getElementById('reset-form')
    const resetRequest = document.getElementById('auth-password-reset-request')
    const resetBackLogin = document.getElementById('reset-back-login')
    const passwordToggle = document.getElementById('auth-password-toggle')
    const resetPasswordToggle = document.getElementById('reset-password-toggle')

    window.__MIXING_AUTH_MODAL__ = true
    window.openMixingAuth = openAuth

    loginBtn?.addEventListener('click', () => openAuth('login'))
    registerBtn?.addEventListener('click', () => openAuth('register'))
    closeBtn?.addEventListener('click', closeAuth)
    modal?.addEventListener('click', event => {
      if (event.target === modal) closeAuth()
    })
    loginTab?.addEventListener('click', () => setMode('login'))
    registerTab?.addEventListener('click', () => setMode('register'))
    form?.addEventListener('submit', submitAuth)
    resetForm?.addEventListener('submit', saveNewPassword)
    resetRequest?.addEventListener('click', requestPasswordReset)
    resetBackLogin?.addEventListener('click', () => setMode('login'))
    passwordToggle?.addEventListener('click', togglePasswordVisibility)
    resetPasswordToggle?.addEventListener('click', event => togglePasswordVisibility(event, 'reset-password'))

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
    const modal = document.getElementById('auth-modal')
    modal?.classList.add('open')
    modal?.setAttribute('aria-hidden', 'false')
    document.getElementById('auth-email')?.focus()
  }

  function closeAuth() {
    const modal = document.getElementById('auth-modal')
    modal?.classList.remove('open')
    modal?.setAttribute('aria-hidden', 'true')
  }

  function setMode(nextMode) {
    mode = nextMode
    const isRegister = mode === 'register'
    const isReset = mode === 'reset'
    const nameField = document.getElementById('auth-name-field')
    const passwordField = document.getElementById('auth-password')
    const authForm = document.getElementById('auth-form')
    const resetForm = document.getElementById('reset-form')
    const authTabs = document.querySelector('.vip-tabs')
    const resetRequest = document.getElementById('auth-password-reset-request')

    document.getElementById('auth-login-tab')?.classList.toggle('active', !isRegister && !isReset)
    document.getElementById('auth-register-tab')?.classList.toggle('active', isRegister)
    if (nameField) nameField.style.display = isRegister && !isReset ? 'grid' : 'none'
    if (passwordField) passwordField.autocomplete = isRegister ? 'new-password' : 'current-password'
    if (authForm) authForm.style.display = isReset ? 'none' : 'grid'
    if (resetForm) resetForm.style.display = isReset ? 'grid' : 'none'
    if (authTabs) authTabs.style.display = isReset ? 'none' : 'flex'
    if (resetRequest) resetRequest.style.display = isRegister || isReset ? 'none' : 'inline-block'

    document.getElementById('auth-title').textContent = isReset ? 'Đặt mật khẩu mới' : isRegister ? 'Tạo tài khoản mới' : 'Chào mừng trở lại'
    document.getElementById('auth-lead').textContent = isReset
      ? 'Nhập mật khẩu mới cho tài khoản của bạn.'
      : isRegister
        ? 'Đăng ký tài khoản dùng chung cho Tra cứu, Chatbox AI và LHU Journal.'
        : 'Đăng nhập để dùng các chức năng tài khoản trong hệ thống.'
    document.getElementById('auth-submit-label').textContent = isRegister ? 'Tạo tài khoản' : 'Đăng nhập'
    setMessage('')
    setResetMessage('')
  }

  async function submitAuth(event) {
    event.preventDefault()
    const email = document.getElementById('auth-email')?.value.trim()
    const password = document.getElementById('auth-password')?.value
    const name = document.getElementById('auth-name')?.value.trim()
    const submit = document.getElementById('auth-submit')
    const submitLabel = document.getElementById('auth-submit-label')

    if (!email || !password) return setMessage('Vui lòng nhập email và mật khẩu.', true)

    submit.disabled = true
    submitLabel.textContent = mode === 'register' ? 'Đang tạo...' : 'Đang đăng nhập...'

    const displayName = name || email.split('@')[0]
    const result = mode === 'register'
      ? await auth.signUp(
          email,
          password,
          { display_name: displayName, full_name: displayName },
          signUpRedirect ? { emailRedirectTo: new URL(signUpRedirect, window.location.origin).toString() } : {}
        )
      : await auth.signIn(email, password)

    submit.disabled = false
    submitLabel.textContent = mode === 'register' ? 'Tạo tài khoản' : 'Đăng nhập'

    if (result.error) return setMessage(result.error.message, true)

    const shouldRedirect = redirectAfterAuth && (mode === 'login' || result.session)
    setMessage(mode === 'register' && !result.session
      ? 'Đăng ký thành công. Vui lòng kiểm tra email để xác nhận tài khoản.'
      : 'Đăng nhập thành công.', false, true)

    if (shouldRedirect) {
      setTimeout(() => window.location.replace(redirectAfterAuth), 600)
    } else if (mode === 'login' || result.session) {
      setTimeout(closeAuth, 600)
    }
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
    const submit = document.getElementById('reset-submit')
    const label = document.getElementById('reset-submit-label')

    if (password.length < 8) return setResetMessage('Mật khẩu cần có ít nhất 8 ký tự.', true)
    if (password !== confirmation) return setResetMessage('Hai mật khẩu chưa trùng khớp.', true)

    submit.disabled = true
    label.textContent = 'Đang lưu...'
    const { error } = await auth.updatePassword(password)
    submit.disabled = false
    label.textContent = 'Lưu mật khẩu mới'

    if (error) return setResetMessage(error.message || 'Không thể cập nhật mật khẩu.', true)
    cleanRecoveryUrl()
    setResetMessage('Đã cập nhật mật khẩu. Bạn có thể đăng nhập bằng mật khẩu mới.', false, true)
    setTimeout(() => setMode('login'), 900)
  }

  function togglePasswordVisibility(event, inputId = 'auth-password') {
    const input = document.getElementById(inputId)
    const button = event.currentTarget
    if (!input || !button) return
    const showing = input.type === 'text'
    input.type = showing ? 'password' : 'text'
    button.innerHTML = `<i class="fas fa-${showing ? 'eye' : 'eye-slash'}"></i>`
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
