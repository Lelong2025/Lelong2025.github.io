const rawApiBase = import.meta.env.VITE_API_URL || ''

export const appConfig = {
  SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL || '',
  SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '',
  API_BASE: rawApiBase ? rawApiBase.replace(/\/$/, '') : '',
}

export function apiUrl(path = '') {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return appConfig.API_BASE ? `${appConfig.API_BASE}${normalizedPath}` : normalizedPath
}

export function isSupabaseConfigured() {
  return Boolean(appConfig.SUPABASE_URL && appConfig.SUPABASE_PUBLISHABLE_KEY)
}
