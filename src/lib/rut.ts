// RUT chileno: normalización, validación (dígito verificador módulo 11) y formato. Módulo PURO (cliente y servidor).
// Forma canónica guardada en base: "12345678-5" (sin puntos, con guion, K en mayúscula).

/** "12.345.678-5", "12345678 5", "12345678k" → "12345678-5" | "12345678-K". null si no tiene forma de RUT. */
export function normalizeRut(input: unknown): string | null {
  const raw = String(input ?? '').replace(/[.\s-]/g, '').toUpperCase()
  if (!/^\d{7,8}[\dK]$/.test(raw)) return null
  return `${raw.slice(0, -1)}-${raw.slice(-1)}`
}

export function rutCheckDigit(body: string): string {
  let sum = 0
  let factor = 2
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * factor
    factor = factor === 7 ? 2 : factor + 1
  }
  const rest = 11 - (sum % 11)
  if (rest === 11) return '0'
  if (rest === 10) return 'K'
  return String(rest)
}

/** RUT válido: forma correcta y dígito verificador coherente. */
export function isValidRut(input: unknown): boolean {
  const rut = normalizeRut(input)
  if (!rut) return false
  const [body, dv] = rut.split('-')
  return rutCheckDigit(body) === dv
}

/** Para mostrar: "12.345.678-5". Si no es normalizable devuelve el texto original. */
export function formatRut(input: unknown): string {
  const rut = normalizeRut(input)
  if (!rut) return String(input ?? '')
  const [body, dv] = rut.split('-')
  return `${body.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${dv}`
}
