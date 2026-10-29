export const SUPPORTED_LOCALES = ['es', 'en'] as const

export type AppLocale = (typeof SUPPORTED_LOCALES)[number]

export const LOCALE_COOKIE = 'scence_locale_v2'
export const LOCALE_STORAGE_KEY = 'scence_locale_v2'

export function isAppLocale(value: unknown): value is AppLocale {
  return value === 'es' || value === 'en'
}

// Español por defecto para todos: el idioma del navegador o del país ya no cambia la interfaz.
// Inglés solo si la persona lo elige expresamente (cookie del selector de idioma).
export function detectLocale(input: {
  cookieLocale?: string | null
  acceptLanguage?: string | null
  country?: string | null
}): AppLocale {
  return isAppLocale(input.cookieLocale) ? input.cookieLocale : 'es'
}
