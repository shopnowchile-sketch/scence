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
