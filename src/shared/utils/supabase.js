/**
 * Supabase client — shared singleton across the entire app.
 *
 * Usage:
 *   import { supabase } from '@shared/utils/supabase.js'
 *
 * Environment variables (set in .env):
 *   VITE_SUPABASE_URL
 *   VITE_SUPABASE_PUBLISHABLE_KEY
 */
import { createClient } from '@supabase/supabase-js'
import { appConfig } from './config.js'

const supabaseUrl = appConfig.SUPABASE_URL
const supabaseKey = appConfig.SUPABASE_PUBLISHABLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.warn(
    '[Supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY. ' +
    'Create a .env file based on .env.example.'
  )
}

export const supabase = (supabaseUrl && supabaseKey)
  ? createClient(supabaseUrl, supabaseKey)
  : null

if (typeof window !== 'undefined') {
  window.lhuSupabaseConfigured = Boolean(supabase)
  window.lhuSupabase = supabase
}
