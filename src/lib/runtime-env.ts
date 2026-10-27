// Barrera de entorno de SCENCE: decide qué es "producción" y bloquea, fuera de
// ella, el acceso a la base de datos de producción y a los servicios con efectos
// reales (PayPal Live, Resend, Google Calendar, Apify, Meta).
//
// Regla única: producción es VERCEL_ENV === 'production' (variable de sistema de
// Vercel, que no se puede definir desde el panel) y NODE_ENV distinto de
// 'development'. Todo lo demás —localhost, `next dev`, Preview, tests— es "no
// productivo". Sin dependencias: se usa en servidor, middleware (Edge) y navegador.
//
// Nunca se loguean ni se devuelven claves: solo el ref del proyecto de Supabase,
// que no es un secreto.

export const PRODUCTION_SUPABASE_PROJECT_REF = 'xzzbishzfyovrladcaeb'

export type RuntimeEnv = Record<string, string | undefined>

export class NonProductionSafetyError extends Error {
  readonly code = 'NON_PRODUCTION_SAFETY'
  constructor(message: string) {
    super(message)
    this.name = 'NonProductionSafetyError'
  }
}

/**
 * Lecturas literales de `process.env`: el bundler inlinea las NEXT_PUBLIC_* en
 * servidor, Edge y navegador, y el resto se lee en tiempo de ejecución.
 */
export function currentEnv(): RuntimeEnv {
  return {
    VERCEL_ENV: process.env.VERCEL_ENV,
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  }
}

export function isProductionRuntime(env: RuntimeEnv = currentEnv()): boolean {
  return env.VERCEL_ENV === 'production' && env.NODE_ENV !== 'development'
}

/** Valor de una variable solo en producción; fuera de ella, como si no existiera. */
export function productionEnv(name: string, env: RuntimeEnv = process.env): string | undefined {
  return isProductionRuntime(env) ? env[name] : undefined
}

/** Falla de forma explícita si se intenta usar un servicio real fuera de producción. */
export function assertProductionRuntime(feature: string, env: RuntimeEnv = currentEnv()): void {
  if (!isProductionRuntime(env)) {
    throw new NonProductionSafetyError(
      `${feature} está desactivado fuera de producción (VERCEL_ENV=${env.VERCEL_ENV ?? 'no definido'}).`,
    )
  }
}

// ── Base de datos ────────────────────────────────────────────────────────────

/** Ref del proyecto a partir de `https://<ref>.supabase.co`. */
export function supabaseRefFromUrl(url?: string): string | null {
  if (!url) return null
  try {
    const labels = new URL(url).hostname.toLowerCase().split('.')
    if (labels.length >= 3 && labels.slice(-2).join('.') === 'supabase.co') return labels[labels.length - 3]
  } catch { /* URL inválida */ }
  return null
}

/** Ref del proyecto que lleva una clave JWT de Supabase (anon o service_role). */
export function supabaseRefFromJwt(token?: string): string | null {
  if (!token) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(base64)) as { ref?: unknown }
    return typeof payload.ref === 'string' ? payload.ref : null
  } catch {
    return null
  }
}

/** Refs a los que apunta la configuración: URL + claves. Cambiar solo la URL no basta para esquivar el bloqueo. */
export function supabaseTargetRefs(input: { url?: string; anonKey?: string; serviceKey?: string }): string[] {
  const refs = [supabaseRefFromUrl(input.url), supabaseRefFromJwt(input.anonKey), supabaseRefFromJwt(input.serviceKey)]
  return Array.from(new Set(refs.filter((ref): ref is string => Boolean(ref))))
}

const BLOCK_MESSAGE =
  'Bloqueado: este entorno no es producción y está configurado con la base de datos de producción de SCENCE. ' +
  'Use una base de pruebas separada (revise NEXT_PUBLIC_SUPABASE_URL y las claves de Supabase).'

/** Mensaje de bloqueo si un entorno NO productivo apunta a la base de producción; si no, null. */
export function nonProductionDatabaseBlock(env: RuntimeEnv = currentEnv()): string | null {
  if (isProductionRuntime(env)) return null
  const refs = supabaseTargetRefs({
    url: env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
  })
  return refs.includes(PRODUCTION_SUPABASE_PROJECT_REF) ? BLOCK_MESSAGE : null
}

export function assertDatabaseTargetAllowed(env: RuntimeEnv = currentEnv()): void {
  const block = nonProductionDatabaseBlock(env)
  if (block) throw new NonProductionSafetyError(block)
}

/**
 * Versión para el navegador, donde VERCEL_ENV no existe: el entorno se inlinea
 * en la compilación como NEXT_PUBLIC_APP_ENV (ver next.config.mjs). Solo bloquea
 * cuando la compilación es positivamente 'development' o 'preview'; el servidor
 * y el middleware bloquean siempre con el criterio de producción de arriba.
 */
export function browserDatabaseBlock(input: { url?: string; anonKey?: string; appEnv?: string }): string | null {
  if (input.appEnv !== 'development' && input.appEnv !== 'preview') return null
  return supabaseTargetRefs({ url: input.url, anonKey: input.anonKey }).includes(PRODUCTION_SUPABASE_PROJECT_REF)
    ? BLOCK_MESSAGE
    : null
}
