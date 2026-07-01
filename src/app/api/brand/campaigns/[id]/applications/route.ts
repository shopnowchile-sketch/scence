import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { acceptCampaignApplication } from '@/lib/campaign-applications'

type Params = { params: { id: string } }

// GET /api/brand-campaigns/[id]/applications
// Lista todas las invitaciones y postulaciones de la campaña
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!user.user_metadata?.is_brand) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()

  const { data: brand } = await admin
    .from('brands').select('id').eq('user_id', user.id).single()
  if (!brand) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })

  // Verificar ownership de la campaña
  const { data: campaign } = await admin
    .from('campaigns').select('id, visibility').eq('id', params.id).eq('brand_id', brand.id).single()
  if (!campaign) return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })

  const { data, error } = await admin
    .from('campaign_influencers')
    .select(`
      id, application_status, origin, message, fee, deliverables_spec, created_at,
      influencer:influencers (
        id, display_name, avatar_url, bio, categories, city, country,
        influencer_social_profiles (platform, username, followers, engagement_rate, is_primary)
      )
    `)
    .eq('campaign_id', params.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ data: data ?? [], visibility: campaign.visibility })
}

// PATCH /api/brand-campaigns/[id]/applications
// La marca acepta o rechaza una invitación / postulación
// Cuando acepta: crea campaign_deliverables desde deliverables_spec
export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!user.user_metadata?.is_brand) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()

  const { data: brand } = await admin
    .from('brands').select('id, name').eq('user_id', user.id).single()
  if (!brand) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })

  const { data: campaign } = await admin
    .from('campaigns')
    .select('id, name, brand_id, organization_id, status')
    .eq('id', params.id)
    .eq('brand_id', brand.id)
    .single()
  if (!campaign) return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })

  let body: { application_id: string; action: 'accept' | 'reject'; agreed_fee?: number }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { application_id, action, agreed_fee } = body
  if (!application_id) return NextResponse.json({ error: 'application_id requerido' }, { status: 422 })
  if (!['accept', 'reject'].includes(action)) return NextResponse.json({ error: 'action debe ser accept o reject' }, { status: 422 })

  // Verificar que la aplicación exista y esté pendiente
  const { data: application } = await admin
    .from('campaign_influencers')
    .select('id, application_status')
    .eq('id', application_id)
    .eq('campaign_id', params.id)
    .single()

  if (!application) return NextResponse.json({ error: 'Aplicación no encontrada' }, { status: 404 })
  if (application.application_status !== 'pending') {
    return NextResponse.json({ error: 'Solo se pueden gestionar aplicaciones pendientes' }, { status: 422 })
  }

  if (action === 'accept') {
    // Lógica única compartida con el portal Admin (src/lib/campaign-applications.ts)
    const result = await acceptCampaignApplication(admin, {
      campaignId: params.id,
      applicationId: application_id,
      agreedFee: agreed_fee ?? null,
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ ok: true, status: 'accepted' })
  }

  // Reject
  const { error: updateError } = await admin
    .from('campaign_influencers')
    .update({ application_status: 'rejected', updated_at: new Date().toISOString() })
    .eq('id', application_id)

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  return NextResponse.json({ ok: true, status: 'rejected' })
}
