/**
 * Cliente mínimo de Meta Business Discovery + reglas puras de sincronización.
 *
 * Sin dependencias de Supabase ni de Next: todo lo de acá es testeable con
 * `node --test`. La orquestación (lock, lote, escritura) vive en
 * followers-sync.ts.
 *
 * Fuente: GET /{IG_SOURCE_ID}?fields=business_discovery.username(@){...}
 * con el token de usuario del sistema de SCENCE (META_IG_SYSTEM_TOKEN).
 * Solo sirve cuentas profesionales (Empresa/Creador). Meta NO distingue una
 * cuenta personal de un @ inexistente: ambos devuelven 110/2207013 →
 * estado único `not_found` (spike 2026-09-26, doc 07 secc. 8).
 */

export const GRAPH_API_VERSION = 'v26.0'
/** Cuenta profesional de SCENCE desde la que se consulta (influencers.snc). No es secreto. */
export const DEFAULT_IG_SOURCE_ACCOUNT_ID = '17841449435340415'

export type SyncStatus = 'ok' | 'pending' | 'not_found' | 'rate_limited' | 'auth_error' | 'api_error'

export type DiscoveryResult =
  | { kind: 'ok'; followers: number; igUserId: string | null; username: string | null; usagePct: number | null }
  | { kind: 'not_found'; message: string }
  | { kind: 'rate_limited'; message: string }
  | { kind: 'auth_error'; message: string }
  | { kind: 'api_error'; message: string }

type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  json(): Promise<unknown>
}>

const HANDLE_RE = /^[a-z0-9._]{1,30}$/

/** Normaliza @handle, handle o URL de perfil. Devuelve null si no es un handle válido. */
export function cleanInstagramHandle(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = raw.trim()
  if (!s) return null
  if (s.startsWith('http') || s.includes('instagram.com')) {
    try {
      const url = new URL(s.startsWith('http') ? s : `https://${s}`)
      const part = url.pathname.split('/').filter(Boolean).find(p => !['p', 'reel', 'reels', 'stories'].includes(p))
      const handle = part?.replace(/^@/, '').toLowerCase() ?? null
      return handle && HANDLE_RE.test(handle) ? handle : null
    } catch {
      return null
    }
  }
  const handle = s.replace(/^@/, '').toLowerCase()
  return HANDLE_RE.test(handle) ? handle : null
}

/** Mayor % de uso reportado por Meta en los headers de rate limit (0-100), o null. */
export function parseUsagePct(headers: { get(name: string): string | null }): number | null {
  const values: number[] = []
  const collect = (obj: unknown) => {
    if (!obj || typeof obj !== 'object') return
    for (const v of Object.values(obj as Record<string, unknown>)) {
      if (typeof v === 'number') values.push(v)
      else if (Array.isArray(v)) v.forEach(collect)
      else collect(v)
    }
  }
  for (const name of ['x-business-use-case-usage', 'x-app-usage']) {
    const raw = headers.get(name)
    if (!raw) continue
    try { collect(JSON.parse(raw)) } catch { /* header ilegible: se ignora */ }
  }
  // estimated_time_to_regain_access es minutos, no %: solo cuentan valores 0-100.
  const pcts = values.filter(v => v >= 0 && v <= 100)
  return pcts.length ? Math.max(...pcts) : null
}

/** Clasifica un error de la Graph API en un estado de sincronización. */
export function classifyGraphError(httpStatus: number, error: { code?: number; error_subcode?: number; message?: string } | undefined): DiscoveryResult {
  const code = error?.code
  const subcode = error?.error_subcode
  const message = (error?.message ?? `HTTP ${httpStatus}`).slice(0, 300)
  if (code === 110 && subcode === 2207013) return { kind: 'not_found', message }
  if (httpStatus === 429 || [4, 17, 32, 613, 80002].includes(code ?? -1)) return { kind: 'rate_limited', message }
  if (code === 190 || code === 102 || code === 10 || (code !== undefined && code >= 200 && code <= 299) || httpStatus === 401 || httpStatus === 403) {
    return { kind: 'auth_error', message }
  }
  return { kind: 'api_error', message }
}

export async function fetchBusinessDiscovery(
  handle: string,
  opts: { token: string; sourceAccountId?: string; fetchImpl?: FetchLike; timeoutMs?: number },
): Promise<DiscoveryResult> {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike)
  const source = opts.sourceAccountId ?? DEFAULT_IG_SOURCE_ACCOUNT_ID
  const fields = `business_discovery.username(${handle}){username,followers_count,id}`
  // Método documentado por Meta: access_token como parámetro. Esta URL nunca
  // se loguea (los logs solo llevan handle, ids y resultado).
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${source}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(opts.token)}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000)
  try {
    const res = await fetchImpl(url, { signal: controller.signal })
    const body = await res.json().catch(() => ({})) as {
      business_discovery?: { username?: string; followers_count?: unknown; id?: string }
      error?: { code?: number; error_subcode?: number; message?: string }
    }
    if (!res.ok || body.error) return classifyGraphError(res.status, body.error)
    const bd = body.business_discovery
    const followers = bd?.followers_count
    if (typeof followers !== 'number' || !Number.isFinite(followers) || !Number.isInteger(followers) || followers < 0) {
      return { kind: 'api_error', message: 'invalid_followers_count' }
    }
    return { kind: 'ok', followers, igUserId: bd?.id ?? null, username: bd?.username?.toLowerCase() ?? null, usagePct: parseUsagePct(res.headers) }
  } catch (error) {
    const aborted = (error as Error)?.name === 'AbortError'
    return { kind: 'api_error', message: aborted ? 'timeout' : String((error as Error)?.message ?? error).slice(0, 300) }
  } finally {
    clearTimeout(timer)
  }
}

export type ProfileSnapshot = {
  followers: number | null
  raw_data: Record<string, unknown> | null
}

export type SyncPatch = {
  sync_status: SyncStatus
  sync_error: string | null
  sync_attempted_at: string
  sync_locked_until: null
  followers?: number
  synced_at?: string
  last_synced_at?: string
  raw_data?: Record<string, unknown>
}

/** % de variación a partir del cual se registra una anomalía (no se bloquea). */
export const ANOMALY_RATIO = 0.5
const ANOMALY_MIN_BASE = 1000

/**
 * Decide qué escribir a partir del resultado de Instagram. Regla de integridad:
 * nunca se escribe followers inválido, y un fallo NUNCA toca el último valor válido.
 * Una caída a 0 desde un valor positivo se trata como error de la API (no se escribe).
 */
export function buildSyncPatch(prev: ProfileSnapshot, result: DiscoveryResult, now: Date): { patch: SyncPatch; anomaly: string | null } {
  const at = now.toISOString()
  const base = { sync_attempted_at: at, sync_locked_until: null } as const
  if (result.kind !== 'ok') {
    return { patch: { ...base, sync_status: result.kind, sync_error: result.message }, anomaly: null }
  }
  const prevFollowers = typeof prev.followers === 'number' ? prev.followers : null
  if (result.followers === 0 && prevFollowers !== null && prevFollowers > 0) {
    return { patch: { ...base, sync_status: 'api_error', sync_error: 'zero_from_positive' }, anomaly: `0 desde ${prevFollowers}` }
  }
  let anomaly: string | null = null
  if (prevFollowers !== null && prevFollowers >= ANOMALY_MIN_BASE) {
    const ratio = Math.abs(result.followers - prevFollowers) / prevFollowers
    if (ratio > ANOMALY_RATIO) anomaly = `${prevFollowers} → ${result.followers}`
  }
  const raw: Record<string, unknown> = { ...(prev.raw_data ?? {}) }
  if (result.igUserId) raw.ig_user_id = result.igUserId
  if (result.username) raw.ig_username = result.username
  if (anomaly) raw.last_anomaly = { at, detail: anomaly }
  return {
    patch: {
      ...base,
      sync_status: 'ok',
      sync_error: null,
      followers: result.followers,
      synced_at: at,
      last_synced_at: at,
      raw_data: raw,
    },
    anomaly,
  }
}
