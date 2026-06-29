/**
 * POST /api/influencers/sync-instagram
 *   Inicia Apify run. Retorna { runId, total } sin esperar.
 *
 * GET /api/influencers/sync-instagram?runId=xxx
 *   Polling. Cuando SUCCEEDED guarda resultados y retorna reporte.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@/lib/supabase/server'

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const APIFY_TOKEN = process.env.APIFY_API_TOKEN
const ACTOR_ID   = 'apify/instagram-profile-scraper'

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
async function fetchDBProfiles(influencerIds?: string[]): Promise<DBProfile[]> {
  let q = admin
    .from('influencer_social_profiles')
    .select('id, influencer_id, username, profile_url')
    .eq('platform', 'instagram')

  if (influencerIds?.length) q = q.in('influencer_id', influencerIds)

  const { data, error } = await q
  if (error) throw new Error(error.message)

  const profiles: DBProfile[] = []
  for (const row of data ?? []) {
    // Try username field first, then profile_url
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
  return profiles
}

// ── POST — inicia run ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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

  const startRes = await fetch(
    `https://api.apify.com/v2/acts/${encodeURIComponent(ACTOR_ID)}/runs?token=${APIFY_TOKEN}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernames: uniqueHandles }),
    }
  )

  if (!startRes.ok) {
    const txt = await startRes.text()
    return NextResponse.json({ error: `Apify error ${startRes.status}: ${txt.slice(0, 200)}` }, { status: 502 })
  }

  const { data: runData } = await startRes.json()
  const runId: string = runData?.id
  if (!runId) return NextResponse.json({ error: 'Apify no devolvió runId' }, { status: 502 })

  return NextResponse.json({ runId, total: uniqueHandles.length })
}

// ── GET — polling + save ──────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!APIFY_TOKEN) return NextResponse.json({ error: 'APIFY_API_TOKEN no configurado' }, { status: 500 })

  const runId = new URL(req.url).searchParams.get('runId')
  if (!runId) return NextResponse.json({ error: 'runId requerido' }, { status: 400 })

  // Check run status
  const statusRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_TOKEN}`)
  if (!statusRes.ok) return NextResponse.json({ error: `Apify status error: ${statusRes.status}` }, { status: 502 })

  const { data: runInfo } = await statusRes.json()
  const status: string = runInfo?.status ?? 'UNKNOWN'

  if (['RUNNING', 'READY', 'INITIALIZING'].includes(status)) {
    return NextResponse.json({ status })
  }
  if (status !== 'SUCCEEDED') {
    return NextResponse.json({ status, error: `Run terminó con estado: ${status}` }, { status: 502 })
  }

  // Fetch dataset
  const dataRes = await fetch(
    `https://api.apify.com/v2/actor-runs/${runId}/dataset/items?token=${APIFY_TOKEN}&limit=1000&format=json`
  )
  if (!dataRes.ok) return NextResponse.json({ error: `Dataset error: ${dataRes.status}` }, { status: 502 })

  const rawData = await dataRes.json()
  const items: ApifyProfile[] = Array.isArray(rawData) ? rawData
    : (rawData?.items ?? rawData?.data ?? [])

  console.log('[sync-ig GET] dataset items:', items.length,
    '| sample usernames:', items.slice(0, 3).map((i: ApifyProfile) => i.username))

  if (items.length === 0) {
    return NextResponse.json({
      status: 'SUCCEEDED', synced: 0, failed: 0,
      message: 'Apify no devolvió resultados. Las cuentas pueden ser privadas o los handles incorrectos.',
    })
  }

  // Build lookup map from DB
  let dbProfiles: DBProfile[]
  try { dbProfiles = await fetchDBProfiles() }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }) }

  // Map: clean_handle → db profile (handle collisions → first wins)
  const byHandle = new Map<string, DBProfile>()
  for (const p of dbProfiles) {
    if (!byHandle.has(p.clean_handle)) byHandle.set(p.clean_handle, p)
  }

  const report = { synced: 0, failed: 0, errors: [] as string[], notFound: [] as string[] }

  for (const item of items) {
    if (!item.username) continue
    const handle = item.username.toLowerCase().trim()
    const row = byHandle.get(handle)

    if (!row) {
      report.notFound.push(handle)
      continue
    }

    const followers      = item.followersCount ?? null
    const engagementRate = computeEngagement(item)
    const avatarUrl      = item.profilePicUrlHD ?? item.profilePicUrl ?? null

    // 1. Update social_profile: followers + engagement_rate + clean username
    const spUpdate: Record<string, unknown> = {
      followers,
      username: handle, // store clean handle
    }
    if (engagementRate !== null) spUpdate.engagement_rate = engagementRate

    const { error: spErr } = await admin
      .from('influencer_social_profiles')
      .update(spUpdate)
      .eq('id', row.id)

    if (spErr) {
      // fallback without engagement_rate
      const { error: spErr2 } = await admin
        .from('influencer_social_profiles')
        .update({ followers, username: handle })
        .eq('id', row.id)
      if (spErr2) {
        report.errors.push(`@${handle}: ${spErr2.message}`)
        report.failed++
        continue
      }
    }

    // 2. Update influencer: avatar_url + metadata
    try {
      const { data: inf } = await admin
        .from('influencers')
        .select('id, avatar_url, metadata')
        .eq('id', row.influencer_id)
        .single()

      const meta: Record<string, unknown> = { ...(inf?.metadata as Record<string, unknown> ?? {}) }
      if (item.biography)          meta.instagram_bio         = item.biography
      if (item.postsCount)         meta.instagram_posts_count = item.postsCount
      if (item.verified != null)   meta.instagram_verified    = item.verified
      if (engagementRate !== null) meta.instagram_engagement  = engagementRate
      meta.last_ig_sync = new Date().toISOString()

      const infUpdate: Record<string, unknown> = { metadata: meta }
      // Only update avatar if influencer doesn't already have one, or update always
      if (avatarUrl) infUpdate.avatar_url = avatarUrl

      await admin.from('influencers').update(infUpdate).eq('id', row.influencer_id)
    } catch { /* non-fatal */ }

    report.synced++
    byHandle.delete(handle)
    console.log(`[sync-ig] ✓ @${handle}: ${followers?.toLocaleString()} seg, ${engagementRate ?? '-'}% eng, foto: ${!!avatarUrl}`)
  }

  // Remaining in byHandle = sent to Apify but not returned (private/deleted/wrong handle)
  report.failed = byHandle.size
  console.log(`[sync-ig] done — synced:${report.synced} failed:${report.failed} notFound:${report.notFound.length}`)

  return NextResponse.json({ status: 'SUCCEEDED', ...report })
}
