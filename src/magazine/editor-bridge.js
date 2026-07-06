import { auth } from '../shared/utils/auth.js'
import { supabase } from '../shared/utils/supabase.js'

window.LHU_OPENAI_MODEL = window.LHU_OPENAI_MODEL || 'gpt-4o-mini'
window.lhuSupabaseConfigured = Boolean(supabase)
window.lhuSupabase = supabase
window.lhuRequireAuth = () => auth.requireAuth('/magazine/')
