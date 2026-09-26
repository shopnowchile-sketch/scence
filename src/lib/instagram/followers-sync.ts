/**
 * syncInstagramFollowers(): ÚNICO escritor de influencer_social_profiles.followers
 * para platform='instagram'. Cron, botones de admin, altas y cambios de @
 * pasan por acá. Ver audits/2026-09-25/07_INSTAGRAM_FOLLOWERS_AUDIT.md.
 *
 * Garantías:
 * - Lock por fila (sync_locked_until): dos ejecuciones simultáneas no
 *   sincronizan el mismo perfil.
 * - Un fallo nunca borra ni pone en 0 el último valor válido.
 * - auth_error / rate_limited cortan el lote (sin reintentos en bucle) y
 *   liberan los locks pendientes.
 * - Reanudable: el lote toma nunca-intentados primero y luego los más antiguos.
 */
import {
  buildSyncPatch,
  cleanInstagramHandle,
  fetchBusinessDiscovery,
  type DiscoveryResult,
  type SyncPatch,
  type SyncStatus,
} from './business-discovery'

export type SyncRow = {
  id: string
  influencer_id: string
  username: string | null
  profile_url: string | null
  followers: number | null
  raw_data: Record<string, unknown> | null
}

/** Persistencia. Implementación real: createSupabaseSyncStore(); en tests, en memoria. */
export interface SyncStore {
  /** Reclama (lock) perfiles por id o, sin ids, el siguiente lote de la cola. Solo devuelve los que logró bloquear. */
  claim(opts: { profileIds?: string[]; limit: number; lockUntil: string; now: string }): Promise<SyncRow[]>
  save(id: string, patch: SyncPatch): Promise<{ error: string | null }>
  release(ids: string[]): Promise<void>
  countDue(now: string): Promise<number>
}

export type SyncOutcome = {
  profile_id: string
  influencer_id: string
  handle: string | null
  status: SyncStatus | 'invalid_handle' | 'save_error'
  followers_before: number | null
  followers_after: number | null
  anomaly: string | null
  ms: number
  error: string | null
}

export type SyncReport = {
  attempted: number
  synced: number
  not_found: number
  failed: number
  remaining: number
  stopped: 'auth_error' | 'rate_limited' | 'deadline' | 'usage_budget' | null
  results: SyncOutcome[]
  /** Formato legible para la UI existente (lista de "@handle: motivo"). */
  errors: string[]
}

export type SyncOptions = {
  profileIds?: string[]
  limit?: number
  deadlineMs?: number
  token?: string
  sourceAccountId?: string
  now?: () => Date
  discover?: (handle: string) => Promise<DiscoveryResult>
  /** Corta el lote cuando Meta reporta un uso >= este % (default 80). */
  maxUsagePct?: number
}

export const DEFAULT_BATCH_LIMIT = 150
const LOCK_MS = 5 * 60_000

function log(event: string, data: Record<string, unknown>) {
  // Nunca se loguea el token. Una línea JSON por evento para filtrar en Vercel.
  console.info(`[instagram-followers] ${event} ${JSON.stringify(data)}`)
}

export async function syncInstagramFollowers(store: SyncStore, options: SyncOptions = {}): Promise<SyncReport> {
  const now = options.now ?? (() => new Date())
  const token = options.token ?? process.env.META_IG_SYSTEM_TOKEN
  const discover = options.discover ?? (token
    ? (handle: string) => fetchBusinessDiscovery(handle, { token, sourceAccountId: options.sourceAccountId ?? process.env.META_IG_SOURCE_ACCOUNT_ID })
    : null)
  const report: SyncReport = { attempted: 0, synced: 0, not_found: 0, failed: 0, remaining: 0, stopped: null, results: [], errors: [] }

  if (!discover) {
    // Sin token no se toca nada: ni followers ni estado.
    log('config-error', { reason: 'META_IG_SYSTEM_TOKEN no configurado' })
    throw new Error('META_IG_SYSTEM_TOKEN no configurado')
  }

  const startedAt = now()
  const deadline = startedAt.getTime() + (options.deadlineMs ?? 50_000)
  const claimed = await store.claim({
    profileIds: options.profileIds,
    limit: options.limit ?? DEFAULT_BATCH_LIMIT,
    lockUntil: new Date(startedAt.getTime() + LOCK_MS).toISOString(),
    now: startedAt.toISOString(),
  })

  const maxUsage = options.maxUsagePct ?? 80
  let index = 0
  for (; index < claimed.length; index++) {
    if (now().getTime() > deadline) { report.stopped = 'deadline'; break }
    const row = claimed[index]
    const t0 = Date.now()
    report.attempted++
    const handle = cleanInstagramHandle(row.username) ?? cleanInstagramHandle(row.profile_url)
    const result: DiscoveryResult = handle
      ? await discover(handle)
      : { kind: 'not_found', message: 'invalid_handle' }
    // Problemas globales (token caído, cuota agotada) no son culpa del perfil:
    // no se marca la fila, se libera su lock y se corta el lote.
    if (result.kind === 'auth_error' || result.kind === 'rate_limited') {
      report.stopped = result.kind
      report.failed++
      report.errors.push(`${result.kind}: ${result.message}`)
      log(result.kind.replace('_', '-'), { profile_id: row.id, handle, error: result.message })
      break
    }
    const { patch, anomaly } = buildSyncPatch({ followers: row.followers, raw_data: row.raw_data }, result, now())
    const { error: saveError } = await store.save(row.id, patch)

    const outcome: SyncOutcome = {
      profile_id: row.id,
      influencer_id: row.influencer_id,
      handle,
      status: saveError ? 'save_error' : (handle ? patch.sync_status : 'invalid_handle'),
      followers_before: row.followers,
      followers_after: saveError ? row.followers : (patch.followers ?? row.followers),
      anomaly,
      ms: Date.now() - t0,
      error: saveError ?? patch.sync_error,
    }
    report.results.push(outcome)
    log(outcome.status === 'ok' ? 'success' : outcome.status.replace('_', '-'), {
      profile_id: row.id, handle, before: row.followers, after: outcome.followers_after, ms: outcome.ms, error: outcome.error, anomaly,
    })

    if (saveError) { report.failed++; report.errors.push(`@${handle ?? row.username ?? row.id}: ${saveError}`); continue }
    if (patch.sync_status === 'ok') report.synced++
    else if (patch.sync_status === 'not_found') { report.not_found++; report.errors.push(`@${handle ?? row.username ?? '?'}: no sincronizable (cuenta personal o @ incorrecto)`) }
    else { report.failed++; report.errors.push(`@${handle}: ${patch.sync_error}`) }

    if (result.kind === 'ok' && result.usagePct !== null && result.usagePct >= maxUsage) { report.stopped = 'usage_budget'; index++; break }
  }

  const unprocessed = claimed.slice(index).map(row => row.id)
  if (unprocessed.length) await store.release(unprocessed)
  report.remaining = options.profileIds ? unprocessed.length : await store.countDue(now().toISOString())
  log('batch-done', { attempted: report.attempted, synced: report.synced, not_found: report.not_found, failed: report.failed, remaining: report.remaining, stopped: report.stopped })
  return report
}

// ── Implementación Supabase ─────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60_000
/** Un perfil sincronizado se reintenta cada 24 h; uno "no sincronizable", cada 7 días. */
export const RETRY_OK_MS = DAY_MS
export const RETRY_NOT_FOUND_MS = 7 * DAY_MS

type SupabaseLike = {
  // Cliente de Supabase (admin); tipado laxo para no acoplar a los tipos generados.
  from(table: string): any
}

function dueFilter(now: string) {
  const ok = new Date(Date.parse(now) - RETRY_OK_MS).toISOString()
  const nf = new Date(Date.parse(now) - RETRY_NOT_FOUND_MS).toISOString()
  return `sync_attempted_at.is.null,and(sync_status.neq.not_found,sync_attempted_at.lt.${ok}),and(sync_status.eq.not_found,sync_attempted_at.lt.${nf})`
}

const ROW_FIELDS = 'id, influencer_id, username, profile_url, followers, raw_data'

export function createSupabaseSyncStore(admin: SupabaseLike): SyncStore {
  return {
    async claim({ profileIds, limit, lockUntil, now }) {
      let ids = profileIds ?? []
      if (!profileIds) {
        const { data, error } = await admin
          .from('influencer_social_profiles')
          .select('id, influencers!inner(is_active)')
          .eq('platform', 'instagram')
          .eq('influencers.is_active', true)
          .or(`sync_locked_until.is.null,sync_locked_until.lt.${now}`)
          .or(dueFilter(now))
          .order('sync_attempted_at', { ascending: true, nullsFirst: true })
          .order('synced_at', { ascending: true, nullsFirst: true })
          .limit(limit)
        if (error) throw new Error(`claim select: ${error.message}`)
        ids = (data ?? []).map((row: { id: string }) => row.id)
      }
      if (!ids.length) return []
      // UPDATE condicional = lock atómico: una ejecución concurrente que ya
      // tomó la fila hace que esta la excluya.
      const { data, error } = await admin
        .from('influencer_social_profiles')
        .update({ sync_locked_until: lockUntil })
        .in('id', ids)
        .eq('platform', 'instagram')
        .or(`sync_locked_until.is.null,sync_locked_until.lt.${now}`)
        .select(ROW_FIELDS)
      if (error) throw new Error(`claim lock: ${error.message}`)
      const order = new Map(ids.map((id, i) => [id, i]))
      return ((data ?? []) as SyncRow[]).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    },
    async save(id, patch) {
      const { error } = await admin.from('influencer_social_profiles').update({ ...patch, updated_at: patch.sync_attempted_at }).eq('id', id)
      return { error: error ? error.message : null }
    },
    async release(ids) {
      if (!ids.length) return
      const { error } = await admin.from('influencer_social_profiles').update({ sync_locked_until: null }).in('id', ids)
      if (error) console.error('[instagram-followers] release-error', error.message)
    },
    async countDue(now) {
      const { count, error } = await admin
        .from('influencer_social_profiles')
        .select('id, influencers!inner(is_active)', { count: 'exact', head: true })
        .eq('platform', 'instagram')
        .eq('influencers.is_active', true)
        .or(dueFilter(now))
      if (error) return 0
      return count ?? 0
    },
  }
}

/** IDs de perfiles de Instagram de estas influencers (para sync dirigido). */
export async function instagramProfileIdsFor(admin: SupabaseLike, influencerIds: string[]): Promise<string[]> {
  if (!influencerIds.length) return []
  const { data, error } = await admin
    .from('influencer_social_profiles')
    .select('id')
    .eq('platform', 'instagram')
    .in('influencer_id', influencerIds)
  if (error) throw new Error(error.message)
  return (data ?? []).map((row: { id: string }) => row.id)
}

/**
 * Sync inmediato "mejor esfuerzo" para altas y cambios de @ (1 llamada por
 * perfil). Nunca lanza: si falta el token o Meta falla, el perfil queda en la
 * cola (pending) y lo toma el lote programado.
 */
export async function syncProfilesNow(admin: SupabaseLike, profileIds: string[]): Promise<SyncReport | null> {
  if (!profileIds.length || !process.env.META_IG_SYSTEM_TOKEN) return null
  try {
    return await syncInstagramFollowers(createSupabaseSyncStore(admin), { profileIds, limit: profileIds.length, deadlineMs: 15_000 })
  } catch (error) {
    console.error('[instagram-followers] inline-error', (error as Error).message)
    return null
  }
}
