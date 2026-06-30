import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'

// GET /api/brand/influencers
// Marca ve influencers relacionadas a SUS campañas/asignaciones.
// Misma shape que /api/influencers para reutilizar InfluencersClient.
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

  // Owner: por user_id. Invitado: por metadata.brand_id.
  let brandQuery = admin
    .from('brands')
    .select('id, organization_id, name')
    .limit(1)

  if (metaBrandId) {
    brandQuery = brandQuery.eq('id', metaBrandId)
  } else {
    brandQuery = brandQuery.eq('user_id', user.id)
  }

  const { data: brand, error: brandError } = await brandQuery.maybeSingle()

  if (brandError) {
    console.error('[GET /api/brand/influencers] brand:', brandError)
    return NextResponse.json({ error: brandError.message }, { status: 500 })
  }

  if (!brand) {
    return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })
  }

  const { searchParams } = new URL(req.url)
  const search   = searchParams.get('search')
  const platform = searchParams.get('platform')
  const category = searchParams.get('category')
  const country  = searchParams.get('country')
  const verified = searchParams.get('verified')
  const isActive = searchParams.get('is_active')
  const rawSort  = searchParams.get('sort_by') ?? 'created_at'
  const sortDir  = searchParams.get('sort_dir') === 'asc'
  const page     = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const limit    = Math.max(1, parseInt(searchParams.get('limit') ?? '48', 10))

  const VALID_SORT_COLS = ['created_at', 'updated_at', 'display_name', 'rating', 'is_verified', 'country', 'city'] as const
  const sortBy = (VALID_SORT_COLS as readonly string[]).includes(rawSort) ? rawSort : 'created_at'

  // 1) campañas donde la marca es principal
  const { data: primaryCampaigns, error: primaryErr } = await admin
    .from('campaigns')
    .select('id')
    .eq('brand_id', brand.id)

  if (primaryErr) {
    console.error('[GET /api/brand/influencers] campaigns:', primaryErr)
    return NextResponse.json({ error: primaryErr.message }, { status: 500 })
  }

  // 2) campañas donde la marca es colaboradora
  const { data: collaboratorRows, error: cbErr } = await admin
    .from('campaign_brands')
    .select('campaign_id')
    .eq('brand_id', brand.id)

  if (cbErr) {
    console.error('[GET /api/brand/influencers] campaign_brands:', cbErr)
    return NextResponse.json({ error: cbErr.message }, { status: 500 })
  }

  const campaignIds = Array.from(new Set([
    ...(primaryCampaigns ?? []).map(c => c.id),
    ...(collaboratorRows ?? []).map(r => r.campaign_id),
  ].filter(Boolean)))

  // 3) influencers asignadas a esas campañas
  let campaignInfluencerIds: string[] = []
  if (campaignIds.length > 0) {
    const { data: ciRows, error: ciErr } = await admin
      .from('campaign_influencers')
      .select('influencer_id')
      .in('campaign_id', campaignIds)

    if (ciErr) {
      console.error('[GET /api/brand/influencers] campaign_influencers:', ciErr)
      return NextResponse.json({ error: ciErr.message }, { status: 500 })
    }

    campaignInfluencerIds = (ciRows ?? [])
      .map(r => r.influencer_id)
      .filter(Boolean)
  }

  // 4) influencers asignadas directamente a la marca, si existe brand_influencers
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
    ...campaignInfluencerIds,
    ...directInfluencerIds,
  ]))

  if (influencerIds.length === 0) {
    return NextResponse.json({ data: [], total: 0, page, limit })
  }

  let query = admin
    .from('influencers')
    .select(`
      *,
      social_profiles:influencer_social_profiles (*),
      rate_cards:influencer_rate_cards (*)
    `, { count: 'exact' })
    .in('id', influencerIds)
    .order(sortBy, { ascending: sortDir })
    .range((page - 1) * limit, page * limit - 1)

  if (country) query = query.eq('country', country)
  if (verified === 'true') query = query.eq('is_verified', true)
  if (isActive === 'false') query = query.eq('is_active', false)
  if (isActive === 'true') query = query.eq('is_active', true)
  if (search) {
    query = query.or(`display_name.ilike.%${search}%,city.ilike.%${search}%`)
  }
  if (category) {
    query = query.contains('categories', [category])
  }

  const { data, error, count } = await query

  if (error) {
    console.error('[GET /api/brand/influencers]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const filtered = platform
    ? (data ?? []).filter(inf =>
        (inf.social_profiles as Array<{ platform: string }> | undefined)
          ?.some(sp => sp.platform === platform)
      )
    : (data ?? [])

  return NextResponse.json({
    data: filtered,
    total: count ?? filtered.length,
    page,
    limit,
  })
}
