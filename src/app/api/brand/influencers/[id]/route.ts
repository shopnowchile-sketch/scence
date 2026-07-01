import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'

type Params = { params: { id: string } }

// GET /api/brand/influencers/[id]
// Retorna un influencer por ID — datos limitados para la vista de marca.
//
// FIX (2026-07-01): antes solo validaba organization_id, no la relación real
// con la marca (a diferencia de /api/brand/influencers y
// /api/brand/influencers/ranking, que sí cruzan por campañas/brand_influencers).
// Eso permitía a cualquier marca pedir por ID el perfil completo (bio, redes,
// rate cards) de cualquier influencer del roster de la organización, sin
// relación a sus campañas. Se unifica con el mismo cruce que ya usan esos
// dos endpoints.
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!user.user_metadata?.is_brand) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const metaBrandId = user.user_metadata?.brand_id as string | undefined

  // Owner: por user_id. Invitado: por metadata.brand_id. (mismo patrón que
  // /api/brand/influencers)
  let brandQuery = admin
    .from('brands')
    .select('id, organization_id')
    .limit(1)

  brandQuery = metaBrandId ? brandQuery.eq('id', metaBrandId) : brandQuery.eq('user_id', user.id)

  const { data: brand, error: brandError } = await brandQuery.maybeSingle()

  if (brandError) {
    console.error('[GET /api/brand/influencers/[id]] brand:', brandError)
    return NextResponse.json({ error: brandError.message }, { status: 500 })
  }
  if (!brand) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })

  // Campañas donde la marca es principal o colaboradora
  const { data: primaryCampaigns, error: primaryErr } = await admin
    .from('campaigns')
    .select('id')
    .eq('brand_id', brand.id)

  if (primaryErr) {
    console.error('[GET /api/brand/influencers/[id]] campaigns:', primaryErr)
    return NextResponse.json({ error: primaryErr.message }, { status: 500 })
  }

  const { data: collaboratorRows, error: cbErr } = await admin
    .from('campaign_brands')
    .select('campaign_id')
    .eq('brand_id', brand.id)

  if (cbErr) {
    console.error('[GET /api/brand/influencers/[id]] campaign_brands:', cbErr)
    return NextResponse.json({ error: cbErr.message }, { status: 500 })
  }

  const campaignIds = Array.from(new Set([
    ...(primaryCampaigns ?? []).map(c => c.id),
    ...(collaboratorRows ?? []).map(r => r.campaign_id),
  ].filter(Boolean)))

  let campaignInfluencerIds: string[] = []
  if (campaignIds.length > 0) {
    const { data: ciRows, error: ciErr } = await admin
      .from('campaign_influencers')
      .select('influencer_id')
      .in('campaign_id', campaignIds)

    if (ciErr) {
      console.error('[GET /api/brand/influencers/[id]] campaign_influencers:', ciErr)
      return NextResponse.json({ error: ciErr.message }, { status: 500 })
    }

    campaignInfluencerIds = (ciRows ?? []).map(r => r.influencer_id).filter(Boolean)
  }

  let directInfluencerIds: string[] = []
  try {
    const { data: directRows } = await admin
      .from('brand_influencers')
      .select('influencer_id')
      .eq('brand_id', brand.id)

    directInfluencerIds = (directRows ?? []).map(r => r.influencer_id).filter(Boolean)
  } catch {
    directInfluencerIds = []
  }

  const allowedIds = new Set([...campaignInfluencerIds, ...directInfluencerIds])

  if (!allowedIds.has(params.id)) {
    // Mismo mensaje que "no encontrado" real — no confirmar existencia del ID
    return NextResponse.json({ error: 'Influencer no encontrado' }, { status: 404 })
  }

  const { data, error } = await admin
    .from('influencers')
    .select(`
      id, display_name, bio, avatar_url, categories, country, city,
      influencer_social_profiles (
        platform, username, followers, engagement_rate, is_primary
      ),
      influencer_rate_cards (
        deliverable_type, base_rate, currency
      )
    `)
    .eq('id', params.id)
    .eq('organization_id', brand.organization_id)
    .eq('is_active', true)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return NextResponse.json({ error: 'Influencer no encontrado' }, { status: 404 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data })
}
