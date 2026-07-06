/**
 * Auth helper — wraps Supabase auth for login, logout, and session management.
 *
 * Usage:
 *   import { auth } from '@shared/utils/auth.js'
 *   const user = await auth.getUser()
 *   await auth.signOut()
 */
import { supabase } from './supabase.js'

export const auth = {
  /**
   * Get the current authenticated user (or null).
   */
  async getUser() {
    if (!supabase) return null
    const { data: { user } } = await supabase.auth.getUser()
    return user
  },

  /**
   * Get the current session (or null).
   */
  async getSession() {
    if (!supabase) return null
    const { data: { session } } = await supabase.auth.getSession()
    return session
  },

  /**
   * Sign in with email + password.
   * @param {string} email
   * @param {string} password
   * @returns {{ user, session, error }}
   */
  async signIn(email, password) {
    if (!supabase) return { user: null, session: null, error: new Error('Supabase not configured') }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    return { user: data?.user ?? null, session: data?.session ?? null, error }
  },

  /**
   * Sign up with email + password.
   * @param {string} email
   * @param {string} password
   * @param {Object} metadata
   * @returns {{ user, session, error }}
   */
  async signUp(email, password, metadata = {}, options = {}) {
    if (!supabase) {
      return { user: null, session: null, error: new Error('Supabase not configured') }
    }
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: metadata, ...options },
    })
    return { user: data?.user ?? null, session: data?.session ?? null, error }
  },

  /**
   * Send a password reset email.
   * @param {string} email
   * @returns {{ error }}
   */
  async resetPassword(email, redirectTo = `${window.location.origin}/`) {
    if (!supabase) return { error: new Error('Supabase not configured') }
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
    return { error }
  },

  async updatePassword(password) {
    if (!supabase) return { error: new Error('Supabase not configured') }
    const { data, error } = await supabase.auth.updateUser({ password })
    return { user: data?.user ?? null, error }
  },

  /**
   * Read feature entitlements if a compatible table exists.
   * This is intentionally permissive until the package schema is finalized.
   * @param {string} userId
   * @returns {Object|null}
   */
  async getEntitlements(userId) {
    if (!supabase || !userId) return null
    const candidates = [
      () => supabase.from('user_entitlements').select('*').eq('user_id', userId).maybeSingle(),
      () => supabase.from('vip_users').select('*').eq('user_id', userId).maybeSingle(),
      () => supabase.from('profiles').select('plan, role, ai_plan, vip_until').eq('id', userId).maybeSingle(),
    ]

    for (const query of candidates) {
      try {
        const { data, error } = await query()
        if (!error && data) return data
      } catch (_) {
        // Try the next known shape.
      }
    }
    return null
  },

  /**
   * Sign out the current user.
   */
  async signOut() {
    if (!supabase) return
    await supabase.auth.signOut()
  },

  /**
   * Listen to auth state changes.
   * @param {Function} callback  (event, session) => void
   * @returns {Function}  unsubscribe function
   */
  onAuthStateChange(callback) {
    if (!supabase) return () => {}
    const { data: { subscription } } = supabase.auth.onAuthStateChange(callback)
    return () => subscription.unsubscribe()
  },

  /**
   * Redirect to login page if user is not authenticated.
   * @param {string} loginPath  path to redirect to (default: '/magazine/')
   */
  async requireAuth(loginPath = '/magazine/') {
    const user = await this.getUser()
    if (!user) {
      window.location.href = loginPath
      return null
    }
    return user
  },
}

if (typeof window !== 'undefined') {
  window.lhuRequireAuth = (loginPath = '/magazine/') => auth.requireAuth(loginPath)
}
