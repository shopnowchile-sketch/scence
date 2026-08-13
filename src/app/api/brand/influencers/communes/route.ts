import { NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { resolveBrandAccess } from '@/lib/supabase/ensureOrg'
import { groupCommunes } from '@/lib/communes-chile'

// GET /api/brand/influencers/communes
// Mismo alcance de influencers que /api/brand/influencers: exclusivamente
// relaciones en campaign_influencers — lista de comunas para poblar
// el filtro "Comuna" en /brand-influencers.
export async function GET() {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const admin = createAdminClient()

  const access = await resolveBrandAccess(user.id)
  if (!access) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })
  const brand = { id: access.brandId }

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

  const influencerIds = Array.from(new Set(campaignInfluencerIds))
  if (influencerIds.length === 0) return NextResponse.json({ data: [] })

  const { data, error } = await admin
    .from('influencers')
    .select('commune')
    .in('id', influencerIds)
    .not('commune', 'is', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Mismo criterio que /api/influencers/communes: agrupa por comuna real sin
  // tocar la base (pedido de Pri 2026-07-13).
  const raw = (data ?? []).map(r => r.commune).filter((c): c is string => !!c && c.trim() !== '')
  const communes = groupCommunes(raw)

  return NextResponse.json({ data: communes })
}
