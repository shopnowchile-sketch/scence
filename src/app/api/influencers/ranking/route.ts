import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'
import { buildRankingRows, sortRankingRows, type RankingSortBy } from '@/lib/influencers/ranking'

const ADMIN_ROLES = ['super_admin']

async function isAdmin(userId: string, admin: ReturnType<typeof createAdminClient>) {
  const { data } = await admin
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle()

  return ADMIN_ROLES.includes(String(data?.role ?? ''))
}

export async function GET(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  if (!(await isAdmin(user.id, admin))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search')?.toLowerCase() ?? ''
  const platform = searchParams.get('platform') ?? ''
  const category = searchParams.get('category') ?? ''
  const sortBy = (searchParams.get('sort_by') ?? 'followers') as RankingSortBy
  const sortDir = searchParams.get('sort_dir') === 'asc' ? 'asc' : 'desc'
  // FIX (2026-07-02): el cap estaba en 500 — la org real tiene 1452 influencers,
  // así que ~950 nunca aparecían en /admin-influencers/ranking ni en "Agregar
  // influencer" (AddInfluencerClient, que pide limit=500 a este mismo endpoint).
  // Se sube a 5000 (bien por sobre el roster actual).
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '200', 10), 1), 5000)

  const orgId = await getOrgId(user.id, user.user_metadata, admin)

  // FIX (2026-07-02, UAT en vivo): el fix anterior subió el cap de RESPUESTA
  // (500→5000) pero ninguna de estas 3 queries tenía `.limit()` explícito —
  // PostgREST corta en su default de 1000 filas por query, así que con 1452
  // influencers reales el fetch ya venía corto ANTES de sortear/cortar en JS
  // (confirmado: "Mostrando 1000 influencers" en vez de 1452). Se agrega
  // `.limit(5000)` a las 3 queries, mismo patrón que el fix de /api/dashboard.
  let infQuery = admin
    .from('influencers')
    .select(`
      id,
      user_id,
      display_name,
      email,
      city,
      commune,
      country,
      categories,
      rating,
      social_profiles:influencer_social_profiles (
        platform,
        username,
        followers,
        engagement_rate,
        is_primary
      )
    `)
    .limit(5000)

  if (orgId) infQuery = infQuery.eq('organization_id', orgId)

  const { data: influencers, error: infErr } = await infQuery

  if (infErr) {
    console.error('[GET /api/influencers/ranking] influencers:', infErr)
    return NextResponse.json({ error: infErr.message }, { status: 500 })
  }

  const { data: campaignInfluencersRaw, error: ciErr } = await admin
    .from('campaign_influencers')
    .select('id, influencer_id, status, campaign:campaigns(name)')
    .limit(5000)

  if (ciErr) {
    console.error('[GET /api/influencers/ranking] campaign_influencers:', ciErr)
    return NextResponse.json({ error: ciErr.message }, { status: 500 })
  }

  const campaignInfluencers = (campaignInfluencersRaw ?? []).map(ci => ({
    id: ci.id,
    influencer_id: ci.influencer_id,
    status: ci.status,
    campaign_name: (ci.campaign as { name?: string | null } | null)?.name ?? null,
  }))

  const { data: deliverables, error: delErr } = await admin
    .from('campaign_deliverables')
    .select('influencer_id, campaign_influencer_id, status')
    .limit(10000)

  if (delErr) {
    console.error('[GET /api/influencers/ranking] deliverables:', delErr)
    return NextResponse.json({ error: delErr.message }, { status: 500 })
  }

  const userIds = (influencers ?? [])
    .map(inf => inf.user_id)
    .filter(Boolean) as string[]

  const lastSeenMap: Record<string, string | null> = {}

  if (userIds.length > 0) {
    const { data: profiles } = await admin
      .from('profiles')
      .select('id, last_seen_at')
      .in('id', userIds)

    for (const profile of profiles ?? []) {
      lastSeenMap[profile.id as string] = (profile.last_seen_at as string | null) ?? null
    }
  }

  const enrichedInfluencers = (influencers ?? []).map(inf => ({
    ...inf,
    last_sign_in_at: inf.user_id ? (lastSeenMap[inf.user_id] ?? null) : null,
  }))

  let rows = buildRankingRows(enrichedInfluencers, campaignInfluencers ?? [], deliverables ?? [])

  if (search) {
    rows = rows.filter(inf =>
      String(inf.display_name ?? '').toLowerCase().includes(search) ||
      String(inf.email ?? '').toLowerCase().includes(search) ||
      String(inf.commune ?? inf.city ?? '').toLowerCase().includes(search)
    )
  }

  if (platform) {
    rows = rows.filter(inf =>
      inf.social_profiles?.some(sp => sp.platform === platform)
    )
  }

  if (category) {
    rows = rows.filter(inf =>
      (inf.categories ?? []).includes(category)
    )
  }

  const sorted = sortRankingRows(rows, sortBy, sortDir).slice(0, limit)

  return NextResponse.json({
    data: sorted,
    total: rows.length,
    sort_by: sortBy,
    sort_dir: sortDir,
  })
}
