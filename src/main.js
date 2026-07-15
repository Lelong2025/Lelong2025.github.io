import { initMixingShell } from './shared/shell.js'
import { initAuthModal } from './shared/auth-modal.js'

initMixingShell({ active: 'home' })
initAuthModal()

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('open-auth-login-admin')?.addEventListener('click', () => {
    window.openMixingAuth?.('login')
  })
})
