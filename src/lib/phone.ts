// Teléfonos de influencers: una sola forma de normalizar y de abrir WhatsApp.
// Sin dependencias. El país sale de locations (ver getInfluencerCountry);
// nunca se asume Chile: sin país conocido y sin "+", el valor no se toca.

const DIAL_CODES: Record<string, string> = {
  chile: '56', argentina: '54', bolivia: '591', brasil: '55', colombia: '57',
  'costa rica': '506', ecuador: '593', mexico: '52', panama: '507', peru: '51',
  paraguay: '595', uruguay: '598', venezuela: '58', 'estados unidos': '1',
  canada: '1', espana: '34', portugal: '351', 'reino unido': '44', francia: '33',
  alemania: '49', italia: '39', australia: '61',
}
const KNOWN_CODES = new Set(Object.values(DIAL_CODES))

const key = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

export function dialCodeForCountry(country: string | null | undefined): string | null {
  return country ? DIAL_CODES[key(country)] ?? null : null
}

function withCode(digits: string): string {
  for (const len of [3, 2, 1]) {
    const cc = digits.slice(0, len)
    if (KNOWN_CODES.has(cc)) return `+${cc} ${digits.slice(len)}`
  }
  return `+${digits}`
}

/**
 * Devuelve "+CC número" (p. ej. "+56 912345678"). No duplica el código si ya
 * lo trae. Si no se puede determinar con certeza (sin "+", país desconocido o
 * largo inválido) devuelve el valor limpio sin inventar nada.
 */
export function normalizePhone(raw: string | null | undefined, country?: string | null): string | null {
  if (raw == null) return null
  const clean = raw.replace(/[​-‏‪-‮⁠﻿]/g, '').trim()
  if (!clean) return null
  let digits = clean.replace(/\D/g, '')
  if (digits.length < 7) return clean

  if (clean.startsWith('+')) return withCode(digits)
  if (digits.startsWith('00')) return withCode(digits.slice(2))

  const cc = dialCodeForCountry(country)
  if (!cc) return clean
  digits = digits.replace(/^0+/, '')
  if (digits.startsWith(cc) && digits.length >= cc.length + 8) return `+${cc} ${digits.slice(cc.length)}`
  if (cc === '56' && digits.length !== 9) return clean // móvil/fijo chileno = 9 dígitos
  return `+${cc} ${digits}`
}

/** https://wa.me/<solo dígitos, internacional> o null si no hay número usable. */
export function whatsappUrl(phone: string | null | undefined, country?: string | null): string | null {
  const full = normalizePhone(phone, country)
  if (!full || !full.startsWith('+')) return null
  const digits = full.replace(/\D/g, '')
  return digits.length >= 8 ? `https://wa.me/${digits}` : null
}


// ── Teléfono internacional (E.164) ────────────────────────────────────────────
// Un país = código ISO, nombre en español, prefijo y largo del número nacional.
// Sin dependencias; la validación es por largo (no verifica que la línea exista).
export type PhoneCountry = { iso: string; name: string; dial: string; min: number; max: number; groups: number[] }

export const PHONE_COUNTRIES: PhoneCountry[] = [
  { iso: 'CL', name: 'Chile', dial: '56', min: 9, max: 9, groups: [1, 4, 4] },
  { iso: 'AR', name: 'Argentina', dial: '54', min: 10, max: 11, groups: [2, 4, 4] },
  { iso: 'BO', name: 'Bolivia', dial: '591', min: 8, max: 8, groups: [4, 4] },
  { iso: 'BR', name: 'Brasil', dial: '55', min: 10, max: 11, groups: [2, 5, 4] },
  { iso: 'CO', name: 'Colombia', dial: '57', min: 10, max: 10, groups: [3, 3, 4] },
  { iso: 'CR', name: 'Costa Rica', dial: '506', min: 8, max: 8, groups: [4, 4] },
  { iso: 'EC', name: 'Ecuador', dial: '593', min: 9, max: 9, groups: [2, 3, 4] },
  { iso: 'ES', name: 'España', dial: '34', min: 9, max: 9, groups: [3, 3, 3] },
  { iso: 'US', name: 'Estados Unidos', dial: '1', min: 10, max: 10, groups: [3, 3, 4] },
  { iso: 'MX', name: 'México', dial: '52', min: 10, max: 10, groups: [2, 4, 4] },
  { iso: 'PA', name: 'Panamá', dial: '507', min: 8, max: 8, groups: [4, 4] },
  { iso: 'PY', name: 'Paraguay', dial: '595', min: 9, max: 9, groups: [3, 3, 3] },
  { iso: 'PE', name: 'Perú', dial: '51', min: 9, max: 9, groups: [3, 3, 3] },
  { iso: 'UY', name: 'Uruguay', dial: '598', min: 8, max: 9, groups: [4, 4] },
  { iso: 'VE', name: 'Venezuela', dial: '58', min: 10, max: 10, groups: [3, 3, 4] },
]

export const DEFAULT_PHONE_COUNTRY = 'CL'

export function phoneCountryFlag(iso: string): string {
  return iso.toUpperCase().replace(/./g, c => String.fromCodePoint(127397 + c.charCodeAt(0)))
}

export function phoneCountry(iso: string | null | undefined): PhoneCountry {
  return PHONE_COUNTRIES.find(c => c.iso === iso) ?? PHONE_COUNTRIES[0]
}

/** Quita ceros de troncal y todo lo que no sea dígito. */
function nationalDigits(raw: string, country: PhoneCountry): string {
  let digits = raw.replace(/\D/g, '')
  if (raw.trim().startsWith('+') && digits.startsWith(country.dial)) digits = digits.slice(country.dial.length)
  return digits.replace(/^0+/, '').slice(0, country.max)
}

/** Formato visual del número nacional según el país: "9 1234 5678". */
export function formatNational(raw: string, isoCountry: string): string {
  const country = phoneCountry(isoCountry)
  const digits = nationalDigits(raw, country)
  const parts: string[] = []
  let at = 0
  for (const size of country.groups) {
    if (at >= digits.length) break
    parts.push(digits.slice(at, at + size))
    at += size
  }
  if (at < digits.length) parts.push(digits.slice(at))
  return parts.join(' ')
}

export type PhoneParse = { ok: true; e164: string; iso: string; national: string } | { ok: false; error: string }

/** País + número nacional → E.164 ("+56912345678") o error en español. */
export function toE164(raw: string, isoCountry: string): PhoneParse {
  const country = phoneCountry(isoCountry)
  const digits = nationalDigits(raw, country)
  if (!digits) return { ok: false, error: 'Ingresa tu número de teléfono' }
  if (digits.length < country.min || digits.length > country.max) {
    const expected = country.min === country.max ? `${country.min}` : `${country.min} a ${country.max}`
    return { ok: false, error: `En ${country.name} el número debe tener ${expected} dígitos` }
  }
  return { ok: true, e164: `+${country.dial}${digits}`, iso: country.iso, national: digits }
}

/** Separa un teléfono guardado ("+56912345678" o "+56 912345678") en país + número nacional. */
export function splitStoredPhone(stored: string | null | undefined): { iso: string; national: string } | null {
  const clean = (stored ?? '').trim()
  if (!clean.startsWith('+')) return null
  const digits = clean.replace(/\D/g, '')
  const match = [...PHONE_COUNTRIES].sort((a, b) => b.dial.length - a.dial.length).find(c => digits.startsWith(c.dial))
  return match ? { iso: match.iso, national: digits.slice(match.dial.length) } : null
}

/** Valida un valor llegado a la API: debe ser E.164 de un país soportado. */
export function parseE164(value: string): PhoneParse {
  const split = splitStoredPhone(value)
  if (!split) return { ok: false, error: 'Teléfono inválido: usa el formato internacional (+56…)' }
  return toE164(split.national, split.iso)
}
