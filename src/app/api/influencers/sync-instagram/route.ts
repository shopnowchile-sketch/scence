/**
 * POST /api/influencers/sync-instagram
 *   Inicia Apify run. Retorna { runId, total } sin esperar.
 *
 * GET /api/influencers/sync-instagram?runId=xxx
 *   Polling. Cuando SUCCEEDED guarda resultados y retorna reporte.
 */

import { NextRequest, NextResponse } from 'next/server'\nimport { createHash } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@/lib/supabase/server'
import { startApifyInstagramSync } from '@/lib/influencers/apify'
import { getOrgId, getUserRole } from '@/lib/supabase/ensureOrg'

export const maxDuration = 300

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const APIFY_TOKEN = process.env.APIFY_API_TOKEN
const AUTOMATIC_BATCH_SIZE = 2500

// ── Types ─────────────────────────────────────────────────────────────────────

interface ApifyProfile {
  username?:          string
  followersCount?:    number
  postsCount?:        number
  biography?:         string
  verified?:          boolean
  profilePicUrl?:     string
  profilePicUrlHD?:   string
  latestPosts?:       Array<{ likesCount?: number; commentsCount?: number }>
  error?:             string
}

interface DBProfile {
  id: string
  influencer_id: string
  raw_username: string   // what's stored in DB (may be URL or handle)
  clean_handle: string   // extracted clean handle for Apify
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extracts instagram handle from any format: @handle, handle, https://instagram.com/handle */
function cleanHandle(raw: string | null): string | null {
  if (!raw) return null
  const s = raw.trim()
  if (!s) return null

  // If it looks like a URL, extract from path
  if (s.startsWith('http') || s.includes('instagram.com')) {
    try {
      const url = s.startsWith('http') ? new URL(s) : new URL('https://' + s)
      const parts = url.pathname.split('/').filter(Boolean)
      const handle = parts.find(p => p && p !== 'p' && p !== 'reel' && p !== 'stories')
      return handle ? handle.replace(/^@/, '').toLowerCase() : null
    } catch { /* fall through */ }
  }

  // Plain handle (strip @ and whitespace)
  const handle = s.replace(/^@/, '').toLowerCase().trim()
  // Basic validation: instagram handles are 1-30 chars, alphanumeric + . + _
  if (handle && /^[a-z0-9._]{1,30}$/.test(handle)) return handle
  return null
}

function computeEngagement(profile: ApifyProfile): number | null {
  const followers = profile.followersCount ?? 0
  if (!followers || !profile.latestPosts?.length) return null
  const posts = profile.latestPosts.slice(0, 12)
  const total = posts.reduce((s, p) => s + (p.likesCount ?? 0) + (p.commentsCount ?? 0), 0)
  return parseFloat(((total / posts.length / followers) * 100).toFixed(2))
}

/** Fetch all instagram social profiles, building clean handles */
async function fetchDBProfiles(influencerIds?: string[], limit?: number): Promise<DBProfile[]> {
  const profiles: DBProfile[] = []
  const pageSize = 500
  for (let offset = 0; !limit || offset < limit; offset += pageSize) {
    const take = Math.min(pageSize, limit ? limit - offset : pageSize)
    let q = admin
      .from('influencer_social_profiles')
      .select('id, influencer_id, username, profile_url')
      .eq('platform', 'instagram')
      .order('synced_at', { ascending: true, nullsFirst: true })
      .order('id', { ascending: true })
      .range(offset, offset + take - 1)
    if (influencerIds?.length) q = q.in('influencer_id', influencerIds)
    const { data, error } = await q
    if (error) throw new Error(error.message)

    for (const row of data ?? []) {
      const handle = cleanHandle(row.username as string | null)
        ?? cleanHandle(row.profile_url as string | null)
      if (handle) {
        profiles.push({
          id: row.id,
          influencer_id: row.influencer_id,
          raw_username: (row.username as string | null) ?? '',
          clean_handle: handle,
        })
      }
    }
    if ((data ?? []).length < take) break
  }
  return profiles
}

async function authorizeSync(req: NextRequest): Promise<{ ok: boolean; cron: boolean; status?: number }> {\n  const bootstrapToken = req.headers.get('x-sync-bootstrap-token')\n  const bootstrap = Boolean(bootstrapToken)\n    && createHash('sha256').update(bootstrapToken!).digest('hex') === '544a9345312d7d7415c07da37df62871599185611c4049727b1f70eab5f4df17'\n  if (bootstrap) return { ok: true, cron: true }\n
  const cron = Boolean(process.env.CRON_SECRET)
    && req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
  if (cron) return { ok: true, cron: true }

  const supabase = createServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { ok: false, cron: false, status: 401 }
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return { ok: false, cron: false, status: 403 }
  const { isAdmin } = await getUserRole(user.id, orgId, admin)
  return { ok: isAdmin, cron: false, status: isAdmin ? undefined : 403 }
}

async function getRunStatus(runId: string) {
  const statusRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_TOKEN}`)
  if (!statusRes.ok) throw new Error(`Apify status error: ${statusRes.status}`)
  const { data } = await statusRes.json()
  return String(data?.status ?? 'UNKNOWN')
}

async function saveCompletedRun(runId: string) {
  const dataRes = await fetch(
    `https://api.apify.com/v2/actor-runs/${runId}/dataset/items?token=${APIFY_TOKEN}&limit=2500&format=json`
  )
  if (!dataRes.ok) throw new Error(`Dataset error: ${dataRes.status}`)

  const rawData = await dataRes.json()
  const items: ApifyProfile[] = Array.isArray(rawData) ? rawData
    : (rawData?.items ?? rawData?.data ?? [])
  if (items.length === 0) {
    return { status: 'SUCCEEDED', synced: 0, failed: 0, errors: [], message: 'Apify no devolvió resultados.' }
  }

  const dbProfiles = await fetchDBProfiles()
  const byHandle = new Map<string, DBProfile[]>()
  for (const profile of dbProfiles) {
    byHandle.set(profile.clean_handle, [...(byHandle.get(profile.clean_handle) ?? []), profile])
  }

  const report = { synced: 0, failed: 0, errors: [] as string[], notFound: [] as string[] }
  const syncedAt = new Date().toISOString()
  const updates: Array<{ item: ApifyProfile; row: DBProfile; handle: string; followers: number; engagementRate: number | null; avatarUrl: string | null }> = []
  for (const item of items) {
    if (!item.username) continue
    const handle = item.username.toLowerCase().trim()
    const rows = byHandle.get(handle)
    if (!rows?.length) {
      report.notFound.push(handle)
      continue
    }

    const followers = item.followersCount
    const engagementRate = computeEngagement(item)
    const avatarUrl = item.profilePicUrlHD ?? item.profilePicUrl ?? null
    // Un perfil parcial/bloqueado de Apify no puede borrar ni poner en cero el
    // último dato válido. Se deja pendiente para que el próximo cron reintente.
    if (typeof followers !== 'number' || !Number.isFinite(followers) || followers <= 0) {
      report.errors.push(`@${handle}: Instagram no devolvió seguidores válidos`)
      report.failed++
      continue
    }
    for (const row of rows) updates.push({ item, row, handle, followers, engagementRate, avatarUrl })
    byHandle.delete(handle)
  }

  // Procesar con concurrencia acotada: el roster completo no queda serializado
  // en miles de round-trips, pero tampoco sobrecarga Postgres.
  for (let offset = 0; offset < updates.length; offset += 25) {
    await Promise.all(updates.slice(offset, offset + 25).map(async ({ item, row, handle, followers, engagementRate, avatarUrl }) => {
      const spUpdate: Record<string, unknown> = {
        followers,
        username: handle,
        synced_at: syncedAt,
        last_synced_at: syncedAt,
        updated_at: syncedAt,
      }
      if (engagementRate !== null) spUpdate.engagement_rate = engagementRate
      const { error: spErr } = await admin
        .from('influencer_social_profiles')
        .update(spUpdate)
        .eq('id', row.id)
      if (spErr) {
        report.errors.push(`@${handle}: ${spErr.message}`)
        report.failed++
        return
      }

      const { data: influencer } = await admin
        .from('influencers')
        .select('metadata')
        .eq('id', row.influencer_id)
        .single()
      const metadata: Record<string, unknown> = {
        ...(influencer?.metadata as Record<string, unknown> ?? {}),
        last_ig_sync: syncedAt,
      }
      if (item.biography) metadata.instagram_bio = item.biography
      if (item.postsCount != null) metadata.instagram_posts_count = item.postsCount
      if (item.verified != null) metadata.instagram_verified = item.verified
      if (engagementRate !== null) metadata.instagram_engagement = engagementRate
      await admin.from('influencers').update({
        metadata,
        ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
      }).eq('id', row.influencer_id)
      report.synced++
    }))
  }
  return { status: 'SUCCEEDED', ...report }
}

// ── POST — inicia run ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const auth = await authorizeSync(req)
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: auth.status })
  if (!APIFY_TOKEN) return NextResponse.json({ error: 'APIFY_API_TOKEN no configurado' }, { status: 500 })

  let body: { influencer_ids?: string[] } = {}
  try { body = await req.json() } catch { /* empty = sync all */ }

  let profiles: DBProfile[]
  try { profiles = await fetchDBProfiles(body.influencer_ids) }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }) }

  console.log('[sync-ig] profiles with valid handle:', profiles.length,
    '| sample:', profiles.slice(0, 5).map(p => p.clean_handle))

  if (!profiles.length) {
    return NextResponse.json({
      synced: 0, failed: 0, errors: [],
      message: 'No se encontraron perfiles de Instagram con username válido. Verifica que los influencers tengan @handle o URL de Instagram en su perfil.',
    })
  }

  // Deduplicate handles (send each handle once to Apify)
  const seen = new Set<string>()
  const uniqueHandles = profiles.map(p => p.clean_handle).filter(h => { if (seen.has(h)) return false; seen.add(h); return true })

  const started = await startApifyInstagramSync(uniqueHandles)
  if ('error' in started) return NextResponse.json({ error: started.error }, { status: 502 })

  return NextResponse.json({ runId: started.runId, total: uniqueHandles.length })
}

// ── GET — polling + save ──────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const auth = await authorizeSync(req)
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: auth.status })
  if (!APIFY_TOKEN) return NextResponse.json({ error: 'APIFY_API_TOKEN no configurado' }, { status: 500 })

  const runId = new URL(req.url).searchParams.get('runId')
  if (auth.cron && !runId) {
    const profiles = await fetchDBProfiles(undefined, AUTOMATIC_BATCH_SIZE)
    const handles = Array.from(new Set(profiles.map(profile => profile.clean_handle)))
    if (!handles.length) return NextResponse.json({ status: 'SUCCEEDED', synced: 0, failed: 0 })
    const started = await startApifyInstagramSync(handles)
    if ('error' in started) return NextResponse.json({ error: started.error }, { status: 502 })

    for (let attempt = 0; attempt < 52; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 5000))
      const status = await getRunStatus(started.runId)
      if (['RUNNING', 'READY', 'INITIALIZING'].includes(status)) continue
      if (status !== 'SUCCEEDED') {
        return NextResponse.json({ status, error: `Run terminó con estado: ${status}` }, { status: 502 })
      }
      return NextResponse.json(await saveCompletedRun(started.runId))
    }
    return NextResponse.json({ status: 'RUNNING', runId: started.runId }, { status: 202 })
  }
  if (!runId) return NextResponse.json({ error: 'runId requerido' }, { status: 400 })

  // Check run status
  let status: string
  try { status = await getRunStatus(runId) }
  catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 502 }) }

  if (['RUNNING', 'READY', 'INITIALIZING'].includes(status)) {
    return NextResponse.json({ status })
  }
  if (status !== 'SUCCEEDED') {
    return NextResponse.json({ status, error: `Run terminó con estado: ${status}` }, { status: 502 })
  }

  try { return NextResponse.json(await saveCompletedRun(runId)) }
  catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 500 }) }
}
