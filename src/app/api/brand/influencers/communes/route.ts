import { NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'

// GET /api/brand/influencers/communes
// Mismo alcance de influencers que /api/brand/influencers (campañas propias +
// colaboradora + brand_influencers) — lista de comunas distintas para poblar
// el filtro "Comuna" en /brand-influencers.
export async function GET() {
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

  let brandQuery = admin.from('brands').select('id').limit(1)
  brandQuery = metaBrandId ? brandQuery.eq('id', metaBrandId) : brandQuery.eq('user_id', user.id)
  const { data: brand, error: brandError } = await brandQuery.maybeSingle()

  if (brandError) return NextResponse.json({ error: brandError.message }, { status: 500 })
  if (!brand) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })

  const { data: primaryCampaigns } = await admin.from('campaigns').select('id').eq('brand_id', brand.id)
  const { data: collaboratorRows } = await admin.from('campaign_brands').select('campaign_id').eq('brand_id', brand.id)

  const campaignIds = Array.from(new Set([
    ...(primaryCampaigns ?? []).map(c => c.id),
    ...(collaboratorRows ?? []).map(r => r.campaign_id),
  ].filter(Boolean)))

  let campaignInfluencerIds: string[] = []
  if (campaignIds.length > 0) {
    const { data: ciRows } = await admin.from('campaign_influencers').select('influencer_id').in('campaign_id', campaignIds)
    campaignInfluencerIds = (ciRows ?? []).map(r => r.influencer_id).filter(Boolean)
  }

  let directInfluencerIds: string[] = []
  try {
    const { data: directRows } = await admin.from('brand_influencers').select('influencer_id').eq('brand_id', brand.id)
    directInfluencerIds = (directRows ?? []).map(r => r.influencer_id).filter(Boolean)
  } catch {
    directInfluencerIds = []
  }

  const influencerIds = Array.from(new Set([...campaignInfluencerIds, ...directInfluencerIds]))
  if (influencerIds.length === 0) return NextResponse.json({ data: [] })

  const { data, error } = await admin
    .from('influencers')
    .select('commune')
    .in('id', influencerIds)
    .not('commune', 'is', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const communes = Array.from(new Set(
    (data ?? []).map(r => r.commune).filter((c): c is string => !!c && c.trim() !== '')
  )).sort((a, b) => a.localeCompare(b, 'es'))

  return NextResponse.json({ data: communes })
}
