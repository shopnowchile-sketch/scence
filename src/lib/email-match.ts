/**
 * Coincidencia exacta (sin distinguir mayúsculas) de correos en consultas
 * `ilike` de PostgREST.
 *
 * `ilike` interpreta `%` y `_` como comodines (y PostgREST convierte `*` en
 * `%`). Un correo como `a_b@x.cl` o `%@x.cl` coincidía con otras marcas: en el
 * registro permitía vincular una marca ajena sin dueño y en las rutas de marca
 * revelaba el nombre de una marca de otra organización. Esta función devuelve
 * el patrón seguro o `null` si el correo no se puede comparar sin ambigüedad
 * (contiene `%`, `*` o `\`); en ese caso el llamador debe NO coincidir.
 */
export function exactEmailPattern(email: string): string | null {
  return exactIlikePattern(email)
}

/** Igual que exactEmailPattern, para cualquier texto (p. ej. nombres de marca). */
export function exactIlikePattern(value: string): string | null {
  const normalized = value.trim()
  if (!normalized || /[%*\\]/.test(normalized)) return null
  return normalized.replace(/_/g, '\\_')
}

/** Formato mínimo aceptado para correos de marca (igual al de register-brand). */
export function isPlausibleEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}
