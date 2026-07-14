import { auth } from '../shared/utils/auth.js'
import { supabase } from '../shared/utils/supabase.js'
import { initAuthModal } from '../shared/auth-modal.js'
import { initMixingShell } from '../shared/shell.js'

window.LHU_OPENAI_MODEL = window.LHU_OPENAI_MODEL || 'gpt-4o-mini'
window.lhuSupabaseConfigured = Boolean(supabase)
window.lhuSupabase = supabase
window.lhuRequireAuth = async () => {
  const user = await auth.getUser()
  document.body?.classList.toggle('magazine-auth-required', !user)
  return user
}

initMixingShell({ active: 'editor', deferInitialLoaderHide: true })

initAuthModal({
  redirectAfterAuth: '/magazine/editor.html',
  passwordResetRedirect: '/magazine/editor.html',
  autoOpen: true,
})

auth.onAuthStateChange((event, session) => {
  const requiresAuth = !session?.user
  document.body?.classList.toggle('magazine-auth-required', requiresAuth)
  if (event === 'SIGNED_OUT') {
    window.openMixingAuth?.('login')
  }
})
