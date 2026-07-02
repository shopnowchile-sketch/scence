import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { buildRankingRows, sortRankingRows, type RankingSortBy } from '@/lib/influencers/ranking'

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
  const metaBrandId = user.user_metadata?.brand_id as string | undefined

  let brandQuery = admin
    .from('brands')
    .select('id, organization_id, name')
    .limit(1)

  if (metaBrandId) brandQuery = brandQuery.eq('id', metaBrandId)
  else brandQuery = brandQuery.eq('user_id', user.id)

  const { data: brand, error: brandError } = await brandQuery.maybeSingle()

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

  const { data: primaryCampaigns, error: primaryErr } = await admin
    .from('campaigns')
    .select('id')
    .eq('brand_id', brand.id)

  if (primaryErr) {
    return NextResponse.json({ error: primaryErr.message }, { status: 500 })
  }

  const { data: collaboratorRows, error: cbErr } = await admin
    .from('campaign_brands')
    .select('campaign_id')
    .eq('brand_id', brand.id)

  if (cbErr) {
    return NextResponse.json({ error: cbErr.message }, { status: 500 })
  }

  const campaignIds = Array.from(new Set([
    ...(primaryCampaigns ?? []).map(c => c.id),
    ...(collaboratorRows ?? []).map(r => r.campaign_id),
  ].filter(Boolean)))

  let campaignInfluencers: Array<{ id?: string | null; influencer_id?: string | null; status?: string | null; campaign_name?: string | null }> = []

  if (campaignIds.length > 0) {
    const { data: ciRows, error: ciErr } = await admin
      .from('campaign_influencers')
      .select('id, influencer_id, status, campaign_id, campaign:campaigns(name)')
      .in('campaign_id', campaignIds)

    if (ciErr) {
      return NextResponse.json({ error: ciErr.message }, { status: 500 })
    }

    campaignInfluencers = (ciRows ?? []).map(ci => ({
      id: ci.id,
      influencer_id: ci.influencer_id,
      status: ci.status,
      campaign_name: (ci.campaign as { name?: string | null } | null)?.name ?? null,
    }))
  }

  let directInfluencerIds: string[] = []

  try {
    const { data: directRows } = await admin
      .from('brand_influencers')
      .select('influencer_id')
      .eq('brand_id', brand.id)

    directInfluencerIds = (directRows ?? [])
      .map(r => r.influencer_id)
      .filter(Boolean)
  } catch {
    directInfluencerIds = []
  }

  const influencerIds = Array.from(new Set([
    ...campaignInfluencers.map(ci => ci.influencer_id).filter(Boolean),
    ...directInfluencerIds,
  ])) as string[]

  if (influencerIds.length === 0) {
    return NextResponse.json({ data: [], total: 0, sort_by: sortBy, sort_dir: sortDir })
  }

  const { data: influencers, error: infErr } = await admin
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
    .in('id', influencerIds)

  if (infErr) {
    return NextResponse.json({ error: infErr.message }, { status: 500 })
  }

  let deliverables: Array<{ influencer_id?: string | null; campaign_influencer_id?: string | null; status?: string | null }> = []

  if (campaignIds.length > 0) {
    const { data: delRows, error: delErr } = await admin
      .from('campaign_deliverables')
      .select('influencer_id, campaign_influencer_id, status, campaign_id')
      .in('campaign_id', campaignIds)

    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 500 })
    }

    deliverables = delRows ?? []
  }

  let rows = buildRankingRows(influencers ?? [], campaignInfluencers, deliverables)

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
