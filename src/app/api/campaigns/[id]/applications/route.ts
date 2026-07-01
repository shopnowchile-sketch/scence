import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'
import { acceptCampaignApplication } from '@/lib/campaign-applications'

type Params = { params: { id: string } }

// PATCH /api/campaigns/[id]/applications
// Equivalente admin de /api/brand/campaigns/[id]/applications — mismo botón
// "Aceptar/Rechazar" del tab Influencers en CampaignDetail.tsx (admin), pero
// antes llamaba a /api/campaigns/[id]/influencers con status='active' sin
// tocar application_status ni mandar email. Ahora usa la misma lógica
// compartida (acceptCampaignApplication) que ya usa el portal Marca.
export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)

  let query = admin.from('campaigns').select('id, organization_id').eq('id', params.id)
  if (orgId) query = query.eq('organization_id', orgId)
  const { data: campaign } = await query.single()
  if (!campaign) return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })

  let body: { application_id: string; action: 'accept' | 'reject'; agreed_fee?: number }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { application_id, action, agreed_fee } = body
  if (!application_id) return NextResponse.json({ error: 'application_id requerido' }, { status: 422 })
  if (!['accept', 'reject'].includes(action)) return NextResponse.json({ error: 'action debe ser accept o reject' }, { status: 422 })

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
    const result = await acceptCampaignApplication(admin, {
      campaignId: params.id,
      applicationId: application_id,
      agreedFee: agreed_fee ?? null,
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ ok: true, status: 'accepted' })
  }

  const { error: updateError } = await admin
    .from('campaign_influencers')
    .update({ application_status: 'rejected', updated_at: new Date().toISOString() })
    .eq('id', application_id)

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  return NextResponse.json({ ok: true, status: 'rejected' })
}
