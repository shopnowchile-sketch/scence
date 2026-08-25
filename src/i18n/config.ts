export const SUPPORTED_LOCALES = ['es', 'en'] as const

export type AppLocale = (typeof SUPPORTED_LOCALES)[number]

export const LOCALE_COOKIE = 'scence_locale'
export const LOCALE_STORAGE_KEY = 'scence_locale'

const LATIN_AMERICA_COUNTRIES = new Set([
  'AR', 'BO', 'CL', 'CO', 'CR', 'CU', 'DO', 'EC', 'SV', 'GT', 'HN',
  'MX', 'NI', 'PA', 'PY', 'PE', 'PR', 'UY', 'VE',
])

export function isAppLocale(value: unknown): value is AppLocale {
  return value === 'es' || value === 'en'
}

export function detectLocale(input: {
  cookieLocale?: string | null
  acceptLanguage?: string | null
  country?: string | null
}): AppLocale {
  if (isAppLocale(input.cookieLocale)) return input.cookieLocale

  const preferredLanguage = input.acceptLanguage
    ?.split(',')[0]
    ?.trim()
    ?.toLowerCase()

  if (preferredLanguage?.startsWith('es')) return 'es'
  if (preferredLanguage?.startsWith('en')) return 'en'

  const country = input.country?.toUpperCase()
  if (country === 'US') return 'en'
  if (country && LATIN_AMERICA_COUNTRIES.has(country)) return 'es'

  return 'es'
}
