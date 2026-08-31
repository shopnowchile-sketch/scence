import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { isInfluencerPro } from '@/lib/influencer-pro'
import { hasBrandPermission, resolveBrandAccess } from '@/lib/supabase/ensureOrg'

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

  const admin = createAdminClient()

  // Owner o miembro activo de brand_members (retira el patrón legacy
  // user_metadata.brand_id — spec Pri 2026-07-10).
  const access = await resolveBrandAccess(user.id)
  if (!access) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })
  if (!hasBrandPermission(access, 'influencer.read')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: brand, error: brandError } = await admin
    .from('brands')
    .select('id, organization_id')
    .eq('id', access.brandId)
    .maybeSingle()

  if (brandError) {
    console.error('[GET /api/brand/influencers/[id]] brand:', brandError)
    return NextResponse.json({ error: brandError.message }, { status: 500 })
  }
  if (!brand) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })

  // Campañas donde la marca es principal o colaboradora
  const { data: primaryCampaigns, error: primaryErr } = await admin
    .from('campaigns')
    .select('id')
    .or(`brand_id.eq.${brand.id},created_by_brand_id.eq.${brand.id}`)

  if (primaryErr) {
    console.error('[GET /api/brand/influencers/[id]] campaigns:', primaryErr)
    return NextResponse.json({ error: primaryErr.message }, { status: 500 })
  }

  const campaignIds = Array.from(new Set((primaryCampaigns ?? []).map(c => c.id).filter(Boolean)))

  let campaignInfluencerIds: string[] = []
  if (campaignIds.length > 0) {
    const { data: ciRows, error: ciErr } = await admin
      .from('campaign_influencers')
      .select('influencer_id')
      .in('campaign_id', campaignIds)
      .eq('application_status', 'accepted')

    if (ciErr) {
      console.error('[GET /api/brand/influencers/[id]] campaign_influencers:', ciErr)
      return NextResponse.json({ error: ciErr.message }, { status: 500 })
    }

    campaignInfluencerIds = (ciRows ?? []).map(r => r.influencer_id).filter(Boolean)
  }

  const allowedIds = new Set(campaignInfluencerIds)

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
    .eq('is_active', true)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return NextResponse.json({ error: 'Influencer no encontrado' }, { status: 404 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const { data: documents } = await admin
    .from('influencer_documents')
    .select('id, document_type, title, original_filename, storage_path, mime_type, file_size, created_at')
    .eq('influencer_id', params.id)
    .order('created_at', { ascending: false })

  const documentsWithUrls = await Promise.all((documents ?? []).map(async document => {
    const { data: signed } = await admin.storage.from('influencer-private-documents').createSignedUrl(document.storage_path, 60 * 5, { download: document.original_filename })
    const { storage_path: _storagePath, ...safeDocument } = document
    return { ...safeDocument, url: signed?.signedUrl ?? null }
  }))

  const isPro = await isInfluencerPro(admin, data.id)
  return NextResponse.json({ data: { ...data, is_pro: isPro, influencer_documents: documentsWithUrls } })
}
