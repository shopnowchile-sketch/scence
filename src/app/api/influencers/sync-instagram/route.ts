/**
 * POST /api/influencers/sync-instagram
 *   Inicia Apify run. Retorna { runId, total } sin esperar.
 *   Si Apify no está disponible, usa el perfil web público de Instagram como
 *   fallback y Playwright como último recurso para syncs dirigidos.
 *
 * GET /api/influencers/sync-instagram?runId=xxx
 *   Polling. Cuando SUCCEEDED guarda resultados y retorna reporte.
 *   El cron también conserva una vía gratuita de rescate si Apify falla.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@/lib/supabase/server'
import { startApifyInstagramSync } from '@/lib/influencers/apify'
import { fetchInstagramProfileFollowersViaPlaywright } from '@/lib/connectors/instagram-playwright-metrics'
import { getOrgId, getUserRole } from '@/lib/supabase/ensureOrg'

export const maxDuration = 300

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const APIFY_TOKEN = process.env.APIFY_API_TOKEN
const AUTOMATIC_BATCH_SIZE = 2500
const FREE_FALLBACK_BATCH_SIZE = 20
const INSTAGRAM_WEB_TIMEOUT_MS = 8_000
const INSTAGRAM_WEB_APP_ID = '936619743392459'
// Margen bajo el maxDuration de la función: se corta el barrido antes de que
// Vercel mate la request, para poder devolver el reporte de lo ya guardado.
const PLAYWRIGHT_TIME_BUDGET_MS = 45_000

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
  clean_handle: string   // extracted clean handle for Apify / Instagram web
}

type FollowersResult = { followers: number } | { error: string }

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

/**
 * Vía gratuita y liviana para leer el contador público de followers.
 * No usa credenciales de la influencer ni terceros pagados. Instagram puede
 * rate-limitarla, por eso nunca reemplaza un valor existente por 0 y se usa
 * con lotes pequeños cuando Apify no está disponible.
 */
async function fetchInstagramProfileFollowersViaWeb(handle: string): Promise<FollowersResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), INSTAGRAM_WEB_TIMEOUT_MS)

  try {
    const res = await fetch(
      `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`,
      {
        headers: {
          Accept: '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          Referer: 'https://www.instagram.com/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'X-IG-App-ID': INSTAGRAM_WEB_APP_ID,
          'X-Requested-With': 'XMLHttpRequest',
        },
        cache: 'no-store',
        signal: controller.signal,
      }
    )

    if (!res.ok) return { error: `Instagram web respondió ${res.status}` }

    const json = await res.json() as {
      data?: { user?: { edge_followed_by?: { count?: unknown } } }
    }
    const raw = json?.data?.user?.edge_followed_by?.count
    const followers = typeof raw === 'number' ? raw : Number(raw)

    if (!Number.isFinite(followers) || followers <= 0) {
      return { error: 'Instagram web no devolvió followers válidos' }
    }

    return { followers: Math.round(followers) }
  } catch (error) {
    if ((error as Error).name === 'AbortError') return { error: 'Timeout consultando Instagram web' }
    return { error: `Error consultando Instagram web: ${(error as Error).message}` }
  } finally {
    clearTimeout(timeout)
  }
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

async function authorizeSync(req: NextRequest): Promise<{ ok: boolean; cron: boolean; status?: number }> {
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
  const updates: Array<{ item: ApifyProfile; row: DBProfile; handle: string; followers: number; engagementRate: number | null }> = []
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
    // Un perfil parcial/bloqueado de Apify no puede borrar ni poner en cero el
    // último dato válido. Se deja pendiente para que el próximo cron reintente.
    if (typeof followers !== 'number' || !Number.isFinite(followers) || followers <= 0) {
      report.errors.push(`@${handle}: Instagram no devolvió seguidores válidos`)
      report.failed++
      continue
    }
    for (const row of rows) updates.push({ item, row, handle, followers, engagementRate })
    byHandle.delete(handle)
  }

  // Procesar con concurrencia acotada: el roster completo no queda serializado
  // en miles de round-trips, pero tampoco sobrecarga Postgres.
  for (let offset = 0; offset < updates.length; offset += 25) {
    await Promise.all(updates.slice(offset, offset + 25).map(async ({ item, row, handle, followers, engagementRate }) => {
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
      // El sync ya no escribe avatar_url: las URLs de foto que devuelve
      // Instagram/su CDN son temporales y quedaban 403 a los pocos dias,
      // dejando avatares rotos en el panel. La foto subida por la creadora
      // (POST /api/influencer/avatar) es la unica fuente de avatar_url.
      await admin.from('influencers').update({ metadata }).eq('id', row.influencer_id)
      report.synced++
    }))
  }
  return { status: 'SUCCEEDED', ...report }
}

async function saveFollowers(rows: DBProfile[], followers: number) {
  const now = new Date().toISOString()
  return admin
    .from('influencer_social_profiles')
    .update({
      followers,
      synced_at: now,
      last_synced_at: now,
      updated_at: now,
    })
    .in('id', rows.map(row => row.id))
}

async function syncProfilesViaFreeFallback(
  profiles: DBProfile[],
  options: { playwright?: boolean } = {}
) {
  const byHandle = new Map<string, DBProfile[]>()

  for (const profile of profiles) {
    byHandle.set(
      profile.clean_handle,
      [...(byHandle.get(profile.clean_handle) ?? []), profile]
    )
  }

  const handles = Array.from(byHandle.keys())
  const report = {
    status: 'SUCCEEDED',
    provider: options.playwright === false ? 'instagram_web' : 'instagram_web+playwright',
    attempted: 0,
    synced: 0,
    failed: 0,
    remaining: 0,
    errors: [] as string[],
  }

  const deadline = Date.now() + PLAYWRIGHT_TIME_BUDGET_MS

  for (const handle of handles) {
    if (Date.now() > deadline) {
      report.remaining = handles.length - report.attempted
      break
    }
    report.attempted++

    let result: FollowersResult = await fetchInstagramProfileFollowersViaWeb(handle)

    // Para syncs dirigidos hacemos un segundo intento con Chromium. En el cron
    // de rescate no se usa Chromium: es demasiado caro para un roster grande.
    if ('error' in result && options.playwright !== false) {
      result = await fetchInstagramProfileFollowersViaPlaywright(handle)
    }

    if ('error' in result || result.followers <= 0) {
      report.failed++
      report.errors.push(`@${handle}: ${'error' in result ? result.error : 'followers inválidos'}`)
      continue
    }

    const rows = byHandle.get(handle) ?? []
    const { error } = await saveFollowers(rows, result.followers)

    if (error) {
      report.failed++
      report.errors.push(`@${handle}: ${error.message}`)
      continue
    }

    report.synced += rows.length
  }

  return report
}

async function syncProfilesViaPlaywright(profiles: DBProfile[]) {
  const byHandle = new Map<string, DBProfile[]>()

  for (const profile of profiles) {
    byHandle.set(
      profile.clean_handle,
      [...(byHandle.get(profile.clean_handle) ?? []), profile]
    )
  }

  // fetchDBProfiles ordena por synced_at nullsFirst, así que los perfiles que
  // nunca se sincronizaron se intentan primero.
  const handles = Array.from(byHandle.keys())
  const report = {
    status: 'SUCCEEDED',
    provider: 'playwright',
    attempted: 0,
    synced: 0,
    failed: 0,
    remaining: 0,
    errors: [] as string[],
  }

  // Presupuesto de tiempo: cada perfil abre Chromium y puede tardar decenas de
  // segundos. Sin este corte la función se queda sin tiempo a mitad de camino y
  // se pierde TODO el reporte (no se sabe qué alcanzó a guardarse). Al agotarse,
  // devuelve lo hecho y cuántos quedan; volver a llamar continúa por los
  // pendientes, que quedan primeros en el orden.
  const deadline = Date.now() + PLAYWRIGHT_TIME_BUDGET_MS

  // Uno por vez: launchContext limpia perfiles temporales antes de abrir
  // Chromium; correr dos simultáneos podría borrar el userDataDir del otro.
  for (const handle of handles) {
    if (Date.now() > deadline) {
      report.remaining = handles.length - report.attempted
      break
    }
    report.attempted++

    const result = await fetchInstagramProfileFollowersViaPlaywright(handle)

    if ('error' in result || result.followers <= 0) {
      report.failed++
      report.errors.push(`@${handle}: ${'error' in result ? result.error : 'followers inválidos'}`)
      continue
    }

    const rows = byHandle.get(handle) ?? []
    const { error } = await saveFollowers(rows, result.followers)

    if (error) {
      report.failed++
      report.errors.push(`@${handle}: ${error.message}`)
      continue
    }

    report.synced += rows.length
  }

  return report
}

// ── POST — inicia run ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const auth = await authorizeSync(req)
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: auth.status })
  let body: { influencer_ids?: string[]; campaign_id?: string; force_playwright?: boolean } = {}
  try { body = await req.json() } catch { /* empty = sync all */ }

  // Sync dirigido por campaña: solo postulantes pendientes reales.
  // Admin-only por authorizeSync(); no abre acceso a marcas ni influencers.
  if (body.campaign_id && !body.influencer_ids?.length) {
    const { data: rows, error } = await admin
      .from('campaign_influencers')
      .select('influencer_id')
      .eq('campaign_id', body.campaign_id)
      .eq('application_status', 'pending')
      .eq('origin', 'application')

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    body.influencer_ids = Array.from(new Set(
      (rows ?? [])
        .map(row => row.influencer_id)
        .filter((id): id is string => Boolean(id))
    ))
  }

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

  // Fallback gratuito completo para syncs dirigidos. Para el roster general se
  // limita el lote por rate-limit de Instagram; los perfiles más antiguos salen
  // primero gracias al orden de fetchDBProfiles.
  const targeted = Boolean(body.influencer_ids?.length || body.campaign_id)

  if (body.force_playwright) {
    if (!targeted) {
      return NextResponse.json(
        { error: 'force_playwright requiere influencer_ids o campaign_id' },
        { status: 422 }
      )
    }
    return NextResponse.json(await syncProfilesViaPlaywright(profiles))
  }

  if (!APIFY_TOKEN) {
    const fallbackProfiles = targeted ? profiles : profiles.slice(0, FREE_FALLBACK_BATCH_SIZE)
    return NextResponse.json(await syncProfilesViaFreeFallback(fallbackProfiles, { playwright: targeted }))
  }

  const started = await startApifyInstagramSync(uniqueHandles)

  if ('error' in started) {
    const fallbackProfiles = targeted ? profiles : profiles.slice(0, FREE_FALLBACK_BATCH_SIZE)
    const fallback = await syncProfilesViaFreeFallback(fallbackProfiles, { playwright: targeted })
    return NextResponse.json({ ...fallback, apifyError: started.error })
  }

  return NextResponse.json({ runId: started.runId, total: uniqueHandles.length })
}

// ── GET — polling + save ──────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const auth = await authorizeSync(req)
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: auth.status })

  const runId = new URL(req.url).searchParams.get('runId')

  if (auth.cron && !runId) {
    const profiles = await fetchDBProfiles(undefined, APIFY_TOKEN ? AUTOMATIC_BATCH_SIZE : FREE_FALLBACK_BATCH_SIZE)
    if (!profiles.length) return NextResponse.json({ status: 'SUCCEEDED', synced: 0, failed: 0 })

    if (!APIFY_TOKEN) {
      return NextResponse.json(await syncProfilesViaFreeFallback(profiles, { playwright: false }))
    }

    const handles = Array.from(new Set(profiles.map(profile => profile.clean_handle)))
    const started = await startApifyInstagramSync(handles)
    if ('error' in started) {
      const fallback = await syncProfilesViaFreeFallback(
        profiles.slice(0, FREE_FALLBACK_BATCH_SIZE),
        { playwright: false }
      )
      return NextResponse.json({ ...fallback, apifyError: started.error })
    }

    for (let attempt = 0; attempt < 52; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 5000))
      const status = await getRunStatus(started.runId)
      if (['RUNNING', 'READY', 'INITIALIZING'].includes(status)) continue
      if (status !== 'SUCCEEDED') {
        const fallback = await syncProfilesViaFreeFallback(
          profiles.slice(0, FREE_FALLBACK_BATCH_SIZE),
          { playwright: false }
        )
        return NextResponse.json({ ...fallback, apifyStatus: status })
      }
      return NextResponse.json(await saveCompletedRun(started.runId))
    }
    return NextResponse.json({ status: 'RUNNING', runId: started.runId }, { status: 202 })
  }

  if (!runId) return NextResponse.json({ error: 'runId requerido' }, { status: 400 })
  if (!APIFY_TOKEN) return NextResponse.json({ error: 'APIFY_API_TOKEN no configurado' }, { status: 500 })

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
