import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { acceptCampaignApplication, rejectCampaignApplications } from '@/lib/campaign-applications'
import { hasBrandPermission, resolveBrandAccess } from '@/lib/supabase/ensureOrg'
import { getInfluencerProStatuses } from '@/lib/influencer-pro'

type Params = { params: { id: string } }

// GET /api/brand-campaigns/[id]/applications
// Lista todas las invitaciones y postulaciones de la campaña
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const access = await resolveBrandAccess(user.id)
  if (!access) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })
  if (!hasBrandPermission(access, 'application.read')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const brand = { id: access.brandId }

  // Verificar ownership de la campaña
  const { data: campaign } = await admin
    .from('campaigns').select('id, visibility, application_questions').eq('id', params.id).eq('brand_id', brand.id).single()
  if (!campaign) return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })

  const { data, error } = await admin
    .from('campaign_influencers')
    .select(`
      id, application_status, origin, message, fee, deliverables_spec, application_answers, created_at,
      influencer:influencers (
        id, display_name, avatar_url, bio, categories, city, country,
        influencer_social_profiles (platform, username, followers, engagement_rate, is_primary)
      )
    `)
    .eq('campaign_id', params.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const proStatuses = await getInfluencerProStatuses(admin, (data ?? []).map(row => row.influencer?.id).filter((id): id is string => Boolean(id)))
  const withPlans = (data ?? []).map(row => ({
    ...row,
    influencer: row.influencer ? { ...row.influencer, is_pro: (proStatuses.get(row.influencer.id) ?? 'free') !== 'free', pro_source: proStatuses.get(row.influencer.id) ?? 'free' } : null,
  }))

  return NextResponse.json({
    data: withPlans,
    visibility: campaign.visibility,
    application_questions: campaign.application_questions ?? [],
  })
}

// PATCH /api/brand-campaigns/[id]/applications
// La marca acepta o rechaza una invitación / postulación
// Cuando acepta: crea campaign_deliverables desde deliverables_spec
export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const access = await resolveBrandAccess(user.id)
  if (!access) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })
  if (!hasBrandPermission(access, 'application.manage')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const brand = { id: access.brandId }

  const { data: campaign } = await admin
    .from('campaigns')
    .select('id, name, brand_id, organization_id, status')
    .eq('id', params.id)
    .eq('brand_id', brand.id)
    .single()
  if (!campaign) return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })

  let body: { application_id?: string; application_ids?: string[]; action: 'accept' | 'reject'; agreed_fee?: number }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { application_id, application_ids, action, agreed_fee } = body
  if (!['accept', 'reject'].includes(action)) return NextResponse.json({ error: 'action debe ser accept o reject' }, { status: 422 })

  if (action === 'reject') {
    const result = await rejectCampaignApplications(admin, {
      campaignId: params.id,
      applicationIds: application_ids ?? (application_id ? [application_id] : []),
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ ok: true, status: 'rejected', rejected_ids: result.rejectedIds })
  }

  if (!application_id) return NextResponse.json({ error: 'application_id requerido' }, { status: 422 })

  // Verificar que la aplicación exista y esté pendiente
  const { data: application } = await admin
    .from('campaign_influencers')
    .select('id, application_status, origin')
    .eq('id', application_id)
    .eq('campaign_id', params.id)
    .single()

  if (!application) return NextResponse.json({ error: 'Aplicación no encontrada' }, { status: 404 })
  if (application.application_status !== 'pending') {
    return NextResponse.json({ error: 'Solo se pueden gestionar aplicaciones pendientes' }, { status: 422 })
  }

  // Gap encontrado en UAT: una invitación (origin='invitation') la manda la
  // marca — quien debe aceptarla es el influencer invitado (PATCH
  // /api/influencer/campaigns/[id]/apply), no la propia marca "aprobando" su
  // propia invitación sin que el influencer haya dicho nada. La marca sí
  // puede rechazar/retirar una invitación pendiente (se mantiene abajo).
  if (action === 'accept' && application.origin === 'invitation') {
    return NextResponse.json({
      error: 'Esta es una invitación enviada por ti — falta que el influencer la acepte, no puedes aprobarla tú.',
    }, { status: 422 })
  }

  // Lógica única compartida con el portal Admin (src/lib/campaign-applications.ts)
  const result = await acceptCampaignApplication(admin, {
    campaignId: params.id,
    applicationId: application_id,
    agreedFee: agreed_fee ?? null,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true, status: 'accepted' })
}
