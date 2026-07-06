import { initMixingShell } from '../shared/shell.js'
import { auth } from '../shared/utils/auth.js'

window.LHU_OPENAI_MODEL = window.LHU_OPENAI_MODEL || 'gpt-4o-mini'

initMixingShell({ active: 'magazine' })

const MAX_LOGIN_ATTEMPTS = 5
const LOCKOUT_MINUTES = 5

let loginAttempts = parseInt(localStorage.getItem('loginAttempts') || '0', 10)
let lockoutTime = parseInt(localStorage.getItem('lockoutTime') || '0', 10)

const lockedMsg = document.getElementById('lockedMsg')
const loginForm = document.getElementById('loginForm')
const registerForm = document.getElementById('registerForm')

if (lockoutTime > Date.now()) {
  if (lockedMsg) lockedMsg.style.display = 'block'
  loginForm?.querySelectorAll('input, button').forEach(el => { el.disabled = true })
}

redirectAuthenticatedUser()
bindFormToggle()
bindPasswordToggle('togglePassword', 'password')
bindPasswordToggle('toggleRegPassword', 'regPassword')
bindPasswordToggle('toggleRegConfirmPassword', 'regConfirmPassword')
loginForm?.addEventListener('submit', submitLogin)
registerForm?.addEventListener('submit', submitRegister)

async function redirectAuthenticatedUser() {
  const user = await auth.getUser()
  if (user) window.location.replace('/magazine/editor.html')
}

function bindFormToggle() {
  const authTitle = document.getElementById('authTitle')
  const authSubtitle = document.getElementById('authSubtitle')
  const linkToRegister = document.getElementById('linkToRegister')
  const linkToLogin = document.getElementById('linkToLogin')

  linkToRegister?.addEventListener('click', () => {
    if (authTitle) authTitle.textContent = 'Đăng Ký'
    if (authSubtitle) authSubtitle.textContent = 'Tạo tài khoản LHU Magazine mới'
    if (loginForm) loginForm.style.display = 'none'
    if (registerForm) registerForm.style.display = 'block'
    hideMessages('errorMsg', 'regErrorMsg', 'regSuccessMsg')
  })

  linkToLogin?.addEventListener('click', () => {
    if (authTitle) authTitle.textContent = 'Đăng Nhập'
    if (authSubtitle) authSubtitle.textContent = 'Truy cập hệ thống LHU Magazine'
    if (loginForm) loginForm.style.display = 'block'
    if (registerForm) registerForm.style.display = 'none'
    hideMessages('errorMsg', 'regErrorMsg', 'regSuccessMsg')
  })
}

function bindPasswordToggle(toggleId, inputId) {
  const toggle = document.getElementById(toggleId)
  const input = document.getElementById(inputId)
  toggle?.addEventListener('click', () => {
    if (!input) return
    const type = input.type === 'password' ? 'text' : 'password'
    input.type = type
    toggle.classList.toggle('fa-eye')
    toggle.classList.toggle('fa-eye-slash')
  })
}

async function submitLogin(event) {
  event.preventDefault()
  if (lockoutTime > Date.now()) return

  const email = document.getElementById('email')?.value.trim()
  const password = document.getElementById('password')?.value
  const errorEl = document.getElementById('errorMsg')
  const submitButton = event.currentTarget.querySelector('button[type="submit"]')

  if (!window.lhuSupabaseConfigured) {
    showMessage(errorEl, 'Chưa cấu hình Supabase publishable key trong .env.')
    return
  }

  try {
    submitButton.disabled = true
    submitButton.textContent = 'Đang đăng nhập...'
    hideMessages('errorMsg')

    const { user, session, error } = await auth.signIn(email, password)
    if (!error && user && session) {
      localStorage.removeItem('loginAttempts')
      localStorage.removeItem('lockoutTime')
      window.location.replace('/magazine/editor.html')
      return
    }

    loginAttempts += 1
    localStorage.setItem('loginAttempts', loginAttempts)
    showMessage(errorEl, `Email hoặc mật khẩu không đúng (${loginAttempts}/${MAX_LOGIN_ATTEMPTS})`)

    if (loginAttempts >= MAX_LOGIN_ATTEMPTS) {
      const lockUntil = Date.now() + LOCKOUT_MINUTES * 60 * 1000
      lockoutTime = lockUntil
      localStorage.setItem('lockoutTime', lockUntil)
      if (lockedMsg) lockedMsg.style.display = 'block'
      loginForm?.querySelectorAll('input, button').forEach(el => { el.disabled = true })
    }
  } catch (_) {
    showMessage(errorEl, 'Lỗi kết nối đến máy chủ!')
  } finally {
    if (lockoutTime <= Date.now() && loginAttempts < MAX_LOGIN_ATTEMPTS) {
      submitButton.disabled = false
    }
    submitButton.textContent = 'Đăng Nhập'
  }
}

async function submitRegister(event) {
  event.preventDefault()

  const name = document.getElementById('regName')?.value.trim()
  const email = document.getElementById('regEmail')?.value.trim()
  const password = document.getElementById('regPassword')?.value
  const confirmPassword = document.getElementById('regConfirmPassword')?.value
  const errorEl = document.getElementById('regErrorMsg')
  const successEl = document.getElementById('regSuccessMsg')
  const submitButton = event.currentTarget.querySelector('button[type="submit"]')

  if (!window.lhuSupabaseConfigured) {
    showMessage(errorEl, 'Chưa cấu hình Supabase publishable key trong .env.')
    return
  }
  if (password !== confirmPassword) {
    showMessage(errorEl, 'Xác nhận mật khẩu không trùng khớp!')
    return
  }
  if (!password || password.length < 6) {
    showMessage(errorEl, 'Mật khẩu phải có ít nhất 6 ký tự!')
    return
  }

  try {
    submitButton.disabled = true
    submitButton.textContent = 'Đang đăng ký...'
    hideMessages('regErrorMsg', 'regSuccessMsg')

    const { session, error } = await auth.signUp(email, password, { full_name: name })
    if (error) {
      showMessage(errorEl, error.message)
      return
    }

    if (session) {
      showMessage(successEl, 'Đăng ký thành công! Đang chuyển hướng...')
      setTimeout(() => window.location.replace('/magazine/editor.html'), 1500)
      return
    }

    showMessage(successEl, 'Đăng ký thành công! Vui lòng kiểm tra email để xác nhận tài khoản.')
    clearValues('regName', 'regEmail', 'regPassword', 'regConfirmPassword')
  } catch (_) {
    showMessage(errorEl, 'Lỗi kết nối đến máy chủ!')
  } finally {
    submitButton.disabled = false
    submitButton.textContent = 'Đăng Ký'
  }
}

function showMessage(element, message) {
  if (!element) return
  element.textContent = message
  element.style.display = 'block'
}

function hideMessages(...ids) {
  ids.forEach(id => {
    const element = document.getElementById(id)
    if (element) element.style.display = 'none'
  })
}

function clearValues(...ids) {
  ids.forEach(id => {
    const element = document.getElementById(id)
    if (element) element.value = ''
  })
}
