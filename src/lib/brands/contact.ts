/**
 * WhatsApp de la marca = `brands.contact_phone` (fuente única, sin columna nueva).
 * Formato canónico: "+<código país><número>", 8–15 dígitos (E.164).
 * Devuelve null si no es válido.
 */
export function normalizeWhatsappPhone(value: unknown): string | null {
  let raw = String(value ?? '').trim().replace(/[\s().-]/g, '')
  if (raw.startsWith('00')) raw = `+${raw.slice(2)}`
  if (!/^\+[1-9]\d{7,14}$/.test(raw)) return null
  return raw
}
