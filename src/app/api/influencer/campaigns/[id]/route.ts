import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getCampaignCoverUrls } from '@/lib/campaign-cover'

type Params = { params: { id: string } }

// GET /api/influencer/campaigns/[id]
// Preview de una campaña ANTES de postular (botón "Ver detalles" desde
// "Campañas Disponibles"). Reutiliza la misma regla de visibilidad que
// /api/influencer/campaigns/open y /apply: visibility='open' + misma org,
// o bien la influencer ya tiene una fila en campaign_influencers (invitada
// o ya postulando) — en ese caso puede ver el detalle igual aunque la
// campaña sea privada.
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: influencer } = await admin
    .from('influencers')
    .select('id, organization_id')
    .eq('user_id', user.id)
    .single()
  if (!influencer) return NextResponse.json({ error: 'Not an influencer account' }, { status: 403 })

  const { data: campaign, error } = await admin
    .from('campaigns')
    .select(`
      id, name, description, content_guidelines, brief_url, type, status, visibility,
      start_date, end_date, budget_total, currency, hashtags, platforms,
      deliverable_templates, application_deadline, applications_closed_at, max_influencers, application_questions,
      campaign_benefits,
      brand:brands!brand_id (id, name, logo_url, website),
      campaign_brands (id, brand:brands!brand_id (id, name, instagram))
    `)
    .eq('id', params.id)
    .eq('organization_id', influencer.organization_id)
    .single()

  if (error || !campaign) return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })

  // Preasignación en draft: una campaña en borrador/revisión NO es visible para
  // la influencer aunque tenga fila en campaign_influencers. Solo al activarla.
  if (campaign.status === 'draft' || campaign.status === 'pending_approval') {
    return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })
  }

  const { data: existing } = await admin
    .from('campaign_influencers')
    .select('id, application_status')
    .eq('campaign_id', params.id)
    .eq('influencer_id', influencer.id)
    .maybeSingle()

  if (!existing && campaign.visibility !== 'open') {
    return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })
  }

  // Rechazada sin participación real: mismo criterio que
  // /api/influencer/my-campaigns — si la postulación/invitación quedó
  // 'rejected' y no hay deliverables, booking, contrato ni pago asociado,
  // se bloquea el acceso al detalle igual que si no existiera (pedido de
  // Pri 2026-07-13). No se toca la fila en la base.
  if (existing?.application_status === 'rejected') {
    const [delivRes, contractRes, invoiceRes, bookingRes] = await Promise.all([
      admin.from('campaign_deliverables').select('id').eq('campaign_influencer_id', existing.id).limit(1),
      admin.from('contracts').select('id').eq('campaign_influencer_id', existing.id).limit(1),
      admin.from('invoice_line_items').select('id').eq('campaign_influencer_id', existing.id).limit(1),
      admin.from('bookings').select('id').eq('campaign_id', params.id).eq('influencer_id', influencer.id).limit(1),
    ])
    const hasParticipation =
      !!delivRes.data?.length || !!contractRes.data?.length || !!invoiceRes.data?.length || !!bookingRes.data?.length
    if (!hasParticipation) {
      return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })
    }
  }

  // Control de acceso por estado (opción A): solo una postulación/invitación
  // ACEPTADA desbloquea el detalle privado. Antes de aceptar (pending o no
  // postulada) se entrega un DTO público limitado: se ocultan las instrucciones
  // de ubicación y el brief privado (brief_url). Los datos
  // necesarios para decidir (nombre, marca, descripción pública, tipo, fechas,
  // presupuesto/remuneración, entregables generales, plazo) quedan visibles.
  const isAccepted = existing?.application_status === 'accepted'
  const payload: Record<string, unknown> = { ...campaign }
  const covers = await getCampaignCoverUrls(admin, [campaign.id])
  payload.cover_url = covers.get(campaign.id) ?? null
  if (!isAccepted) {
    // El brief y el lugar son privados hasta la aceptación; la descripción,
    // requisitos y entregables siguen visibles para decidir si postular.
    delete payload.brief_url
  }

  // Para decidir si postular, la influencer puede ver cuándo es el evento,
  // pero nunca dirección ni instrucciones antes de ser aceptada.
  const { data: eventBooking } = await admin
    .from('bookings')
    .select('id, starts_at, ends_at')
    .eq('campaign_id', params.id)
    .is('influencer_id', null)
    .order('starts_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  const { count: acceptedCount } = await admin
    .from('campaign_influencers')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', params.id)
    .eq('application_status', 'accepted')

  return NextResponse.json({
    data: {
      ...payload,
      accepted_count: acceptedCount ?? 0,
      _applied: !!existing,
      application_status: existing?.application_status ?? null,
      event_booking: eventBooking ?? null,
    },
  })
}
