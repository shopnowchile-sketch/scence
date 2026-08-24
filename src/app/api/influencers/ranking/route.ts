import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { buildRankingRows, sortRankingRows, type RankingSortBy } from '@/lib/influencers/ranking'
import { fetchAllRows } from '@/lib/supabase/fetchAllRows'

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
  const search = searchParams.get('search')?.toLowerCase().replace(/^@+/, '') ?? ''
  const platform = searchParams.get('platform') ?? ''
  const category = searchParams.get('category') ?? ''
  const sortBy = (searchParams.get('sort_by') ?? 'followers') as RankingSortBy
  const sortDir = searchParams.get('sort_dir') === 'asc' ? 'asc' : 'desc'
  // FIX (2026-07-02): el cap estaba en 500 — la org real tiene 1452 influencers,
  // así que ~950 nunca aparecían en /admin-influencers/ranking ni en "Agregar
  // influencer" (AddInfluencerClient, que pide limit=500 a este mismo endpoint).
  // Se sube a 5000 (bien por sobre el roster actual).
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '200', 10), 1), 5000)

  // FIX (2026-07-03, reportado por Pri: "no se puede filtrar por última
  // conexión"): el fix anterior (.limit(5000)) NO alcanzaba — Supabase/PostgREST
  // tiene un tope de Max Rows a nivel de proyecto (1000 por defecto) que se
  // aplica SIEMPRE, sin importar el .limit() del cliente. Confirmado en vivo:
  // total seguía en 1000 con 1452 influencers reales. Se pagina con
  // fetchAllRows (múltiples .range() de a 1000) para traer el dataset completo.
  // Las 3 descargas son independientes → se corren en PARALELO. Antes eran 3
  // cascadas secuenciales (fetchAllRows uno tras otro) cuya SUMA acercaba el
  // endpoint al timeout serverless: "Agregar influencer" se quedaba cargando.
  // Ahora el tiempo total es el del query más lento, no la suma. `profiles` va
  // después porque depende de los user_id de los influencers.
  const [
    { data: influencers, error: infErr },
    { data: campaignInfluencersRaw, error: ciErr },
    { data: deliverables, error: delErr },
  ] = await Promise.all([
    fetchAllRows(
      (from, to) => {
        let q = admin
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
          .range(from, to)
        return q
      },
      { maxRows: 5000 }
    ),
    fetchAllRows(
      (from, to) => admin
        .from('campaign_influencers')
        .select('id, influencer_id, status, campaign:campaigns(name)')
        .range(from, to),
      { maxRows: 5000 }
    ),
    fetchAllRows(
      (from, to) => admin
        .from('campaign_deliverables')
        .select('influencer_id, campaign_influencer_id, status')
        .range(from, to),
      { maxRows: 10000 }
    ),
  ])

  if (infErr) {
    console.error('[GET /api/influencers/ranking] influencers:', infErr)
    return NextResponse.json({ error: (infErr as Error).message ?? 'Error' }, { status: 500 })
  }
  if (ciErr) {
    console.error('[GET /api/influencers/ranking] campaign_influencers:', ciErr)
    return NextResponse.json({ error: (ciErr as Error).message ?? 'Error' }, { status: 500 })
  }
  if (delErr) {
    console.error('[GET /api/influencers/ranking] deliverables:', delErr)
    return NextResponse.json({ error: (delErr as Error).message ?? 'Error' }, { status: 500 })
  }

  const campaignInfluencers = (campaignInfluencersRaw ?? []).map(ci => ({
    id: ci.id,
    influencer_id: ci.influencer_id,
    status: ci.status,
    campaign_name: (ci.campaign as { name?: string | null } | null)?.name ?? null,
  }))

  const userIds = (influencers ?? [])
    .map(inf => inf.user_id)
    .filter(Boolean) as string[]

  const lastSeenMap: Record<string, string | null> = {}

  // FIX (2026-07-11, "Agregar influencer" colgado en prod): con ~1548
  // user_ids (roster de 2446 influencers) este .in() se armaba en UNA sola
  // request GET vía PostgREST — la URL resultante (cientos de UUIDs) queda
  // fuera de los límites razonables de la capa REST/proxy y la request nunca
  // vuelve a responder (se cuelga sin error, el fetch queda pendiente para
  // siempre). Se trocea en lotes chicos ejecutados en paralelo, mismo
  // criterio que fetchAllRows más arriba pero para IN en vez de range().
  if (userIds.length > 0) {
    const CHUNK = 150
    const chunks: string[][] = []
    for (let i = 0; i < userIds.length; i += CHUNK) chunks.push(userIds.slice(i, i + CHUNK))

    const results = await Promise.all(
      chunks.map(ids => admin.from('profiles').select('id, last_seen_at').in('id', ids))
    )

    for (const { data: profiles, error: profErr } of results) {
      if (profErr) {
        console.error('[GET /api/influencers/ranking] profiles chunk failed:', profErr)
        continue // no bloquear el ranking entero por un lote — last_sign_in_at queda null para esos
      }
      for (const profile of profiles ?? []) {
        lastSeenMap[profile.id as string] = (profile.last_seen_at as string | null) ?? null
      }
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
      String(inf.commune ?? inf.city ?? '').toLowerCase().includes(search) ||
      (inf.social_profiles ?? []).some(profile => String(profile.username ?? '').toLowerCase().replace(/^@+/, '').includes(search))
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
