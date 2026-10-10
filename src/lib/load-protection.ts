/**
 * Protección ante picos de carga (incidente 2026-10-06, Login 504).
 *
 * Un aviso de campaña a ~2.700 influencers salió completo en ~2 minutos; la
 * llegada simultánea a /inf-campaign saturó Supabase (Auth, REST y Storage
 * comparten la misma base) durante 13 minutos. Este módulo es puro (sin
 * dependencias) para poder probarlo con `node --test`:
 *
 * - batchPauseMs: pausa entre lotes de envíos masivos para repartir la llegada.
 * - isTemporaryAuthFailure / withDeadline: el middleware distingue "sin sesión"
 *   de "Supabase no responde", para no mandar a /login ni borrar cookies de
 *   una sesión válida por una caída temporal.
 */

// ── Envíos masivos ──────────────────────────────────────────────────────────

/** Pausa objetivo entre lotes de un envío masivo. */
export const BATCH_PAUSE_MS = 5_000

/**
 * Tope de la suma de pausas de un envío. Las rutas que envían avisos tienen
 * maxDuration = 300 s y el envío en sí (consultas + Resend) toma ~60–90 s con
 * el roster actual: 120 s de pausas dejan margen aunque el roster crezca, porque
 * con más lotes la pausa por lote se reduce en vez de alargar el envío.
 */
export const MAX_TOTAL_BATCH_PAUSE_MS = 120_000

/** Pausa a aplicar entre lotes consecutivos (0 si hay un solo lote). */
export function batchPauseMs(totalBatches: number): number {
  if (!Number.isFinite(totalBatches) || totalBatches <= 1) return 0
  return Math.min(BATCH_PAUSE_MS, Math.floor(MAX_TOTAL_BATCH_PAUSE_MS / (totalBatches - 1)))
}

export const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

// ── Auth en el middleware ───────────────────────────────────────────────────

/**
 * Plazo total para verificar/renovar la sesión en el middleware. La librería de
 * Auth reintenta el refresh ante 5xx durante hasta ~30 s, pero Vercel corta el
 * middleware a los 25 s con un error genérico: mejor cortar antes y responder
 * "alta demanda" con reintento.
 */
export const AUTH_DEADLINE_MS = 8_000

/** Segundos que espera la página de alta demanda antes de reintentar sola. */
export const HIGH_DEMAND_RETRY_SECONDS = 5

export class AuthDeadlineError extends Error {
  constructor(ms: number) {
    super(`Auth no respondió en ${ms} ms`)
    this.name = 'AuthDeadlineError'
  }
}

/** Resuelve con `promise` o rechaza con AuthDeadlineError si tarda más de `ms`. */
export function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AuthDeadlineError(ms)), ms)
  })
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer))
}

/**
 * ¿El error de Auth es temporal (servicio caído/saturado) y no "sin sesión"?
 *
 * Temporal: plazo vencido, AuthRetryableFetchError (red, timeout, 502/503/504,
 * 52x) y cualquier respuesta 429 o 5xx. NO temporal: sin error, sesión
 * inexistente, refresh token inválido/usado (400) u otros 4xx → esos sí van a
 * /login como hoy.
 */
export function isTemporaryAuthFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const { name, status } = error as { name?: unknown; status?: unknown }
  if (name === 'AuthDeadlineError' || name === 'AuthRetryableFetchError') return true
  return typeof status === 'number' && (status === 429 || status >= 500)
}
