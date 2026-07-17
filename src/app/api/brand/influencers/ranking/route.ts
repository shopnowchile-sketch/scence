import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { buildRankingRows, sortRankingRows, type RankingSortBy } from '@/lib/influencers/ranking'
import { fetchAllRows } from '@/lib/supabase/fetchAllRows'
import { resolveBrandAccess } from '@/lib/supabase/ensureOrg'

export async function GET(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!user.user_metadata?.is_brand) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createAdminClient()

  const access = await resolveBrandAccess(user.id)
  if (!access) {
    return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })
  }

  const { data: brand, error: brandError } = await admin
    .from('brands')
    .select('id, organization_id, name')
    .eq('id', access.brandId)
    .maybeSingle()

  if (brandError) {
    console.error('[GET /api/brand/influencers/ranking] brand:', brandError)
    return NextResponse.json({ error: brandError.message }, { status: 500 })
  }

  if (!brand) {
    return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })
  }

  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search')?.toLowerCase() ?? ''
  const platform = searchParams.get('platform') ?? ''
  const category = searchParams.get('category') ?? ''
  const sortBy = (searchParams.get('sort_by') ?? 'followers') as RankingSortBy
  const sortDir = searchParams.get('sort_dir') === 'asc' ? 'asc' : 'desc'
  // Mismo fix que /api/influencers/ranking: cap subido de 500 a 5000, la org
  // real tiene 1452 influencers y el cap recortaba la respuesta, no la query.
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '200', 10), 1), 5000)

  const [primaryResult, collaboratorResult] = await Promise.all([
    admin.from('campaigns').select('id').eq('brand_id', brand.id),
    admin.from('campaign_brands').select('campaign_id').eq('brand_id', brand.id),
  ])

  if (primaryResult.error || collaboratorResult.error) {
    return NextResponse.json({ error: (primaryResult.error ?? collaboratorResult.error)?.message }, { status: 500 })
  }

  const campaignIds = Array.from(new Set([
    ...(primaryResult.data ?? []).map(c => c.id),
    ...(collaboratorResult.data ?? []).map(r => r.campaign_id),
  ].filter(Boolean)))

  const [campaignInfluencerResult, directResult] = await Promise.all([
    campaignIds.length > 0
      ? fetchAllRows(
      (from, to) => admin
        .from('campaign_influencers')
        .select('id, influencer_id, status, campaign_id, campaign:campaigns(name)')
        .in('campaign_id', campaignIds)
        .eq('application_status', 'accepted')
        .range(from, to),
      { maxRows: 5000 }
    )
      : Promise.resolve({ data: [], error: null }),
    admin.from('brand_influencers').select('influencer_id').eq('brand_id', brand.id),
  ])

  if (campaignInfluencerResult.error) {
    return NextResponse.json({ error: (campaignInfluencerResult.error as Error).message ?? 'Error' }, { status: 500 })
  }

  const campaignInfluencers = (campaignInfluencerResult.data ?? []).map(ci => ({
      id: ci.id,
      influencer_id: ci.influencer_id,
      status: ci.status,
      campaign_name: (ci.campaign as { name?: string | null } | null)?.name ?? null,
  }))
  const directInfluencerIds = (directResult.data ?? []).map(r => r.influencer_id).filter(Boolean)

  const influencerIds = Array.from(new Set([
    ...campaignInfluencers.map(ci => ci.influencer_id).filter(Boolean),
    ...directInfluencerIds,
  ])) as string[]

  if (influencerIds.length === 0) {
    return NextResponse.json({ data: [], total: 0, sort_by: sortBy, sort_dir: sortDir })
  }

  const influencersPromise = fetchAllRows(
    (from, to) => admin
      .from('influencers')
      .select(`
        id,
        user_id,
        display_name,
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
      .in('id', influencerIds)
      .range(from, to),
    { maxRows: 5000 }
  )
  const deliverablesPromise = campaignIds.length > 0
    ? fetchAllRows(
      (from, to) => admin
        .from('campaign_deliverables')
        .select('influencer_id, campaign_influencer_id, status, campaign_id')
        .in('campaign_id', campaignIds)
        .range(from, to),
      { maxRows: 10000 }
    )
    : Promise.resolve({ data: [], error: null })

  const [influencersResult, deliverablesResult] = await Promise.all([
    influencersPromise,
    deliverablesPromise,
  ])

  if (influencersResult.error || deliverablesResult.error) {
    const error = influencersResult.error ?? deliverablesResult.error
    return NextResponse.json({ error: (error as Error).message ?? 'Error' }, { status: 500 })
  }

  let rows = buildRankingRows(influencersResult.data ?? [], campaignInfluencers, deliverablesResult.data ?? [])

  if (search) {
    rows = rows.filter(inf =>
      String(inf.display_name ?? '').toLowerCase().includes(search) ||
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
