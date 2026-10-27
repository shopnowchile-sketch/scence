/**
 * Límite de intentos en memoria (ventana deslizante) para endpoints públicos.
 *
 * Es de mejor esfuerzo: en serverless cada instancia tiene su propio contador,
 * así que frena ráfagas y scripts simples pero no es una defensa distribuida.
 * La protección fuerte debe venir de una regla de rate limit en el firewall de
 * Vercel (o un CAPTCHA); esto es la capa mínima dentro de la app.
 */
const buckets = new Map<string, number[]>()
const MAX_KEYS = 5000

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const hits = (buckets.get(key) ?? []).filter(t => now - t < windowMs)
  if (hits.length >= limit) {
    buckets.set(key, hits)
    return false
  }
  hits.push(now)
  buckets.set(key, hits)
  if (buckets.size > MAX_KEYS) {
    for (const [k, v] of Array.from(buckets.entries())) {
      if (v.every((t: number) => now - t >= windowMs)) buckets.delete(k)
    }
  }
  return true
}

export function resetRateLimits() {
  buckets.clear()
}

export function clientIp(headers: Headers): string {
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip') || 'unknown'
}
