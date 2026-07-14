import { initMixingShell } from '../shared/shell.js'
import { initAuthModal } from '../shared/auth-modal.js'
import { supabase } from '../shared/utils/supabase.js'

window.LHU_OPENAI_MODEL = window.LHU_OPENAI_MODEL || 'gpt-4o-mini'
window.lhuSupabaseConfigured = Boolean(supabase)
window.lhuSupabase = supabase

initMixingShell({ active: 'editor' })
initAuthModal({
  redirectOnAuthenticated: '/magazine/editor.html',
  redirectAfterAuth: '/magazine/editor.html',
  passwordResetRedirect: '/magazine/',
  autoOpen: true,
})
