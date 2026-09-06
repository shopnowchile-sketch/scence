import { NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getCampaignCoverUrls } from '@/lib/campaign-cover'
import { getCampaignDateKey } from '@/lib/attendance-state'
import { isInfluencerPro } from '@/lib/influencer-pro'

// GET /api/influencer/campaigns/open
// Returns active campaigns the influencer is NOT yet part of (open to apply)
export async function GET() {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const today = getCampaignDateKey()

  const { data: influencer } = await admin
    .from('influencers')
    .select('id, organization_id')
    .eq('user_id', user.id)
    .single()

  if (!influencer) return NextResponse.json({ error: 'Not an influencer account' }, { status: 403 })
  const isPro = await isInfluencerPro(admin, influencer.id)

  // Campañas donde la influencer ya tiene alguna relación (invitada, postulando, aceptada, etc.)
  const { data: myRows } = await admin
    .from('campaign_influencers')
    .select('campaign_id, application_status, origin')
    .eq('influencer_id', influencer.id)

  // Las que siguen "pendiente" se DEJAN ver en Disponibles (con badge de
  // "en revisión") en vez de desaparecer — pedido por Pri, 2026-07-01:
  // antes, apenas postulaba, la campaña se iba de la lista en el próximo
  // refresh y no quedaba ningún rastro visible de la postulación.
  const pendingMap = new Map(
    (myRows ?? [])
      .filter(r => r.application_status === 'pending' && r.origin !== 'invitation')
      .map(r => [r.campaign_id as string, true])
  )
  // FIX (2026-09-06, causa de "la campaña privada no aparece"): una INVITACIÓN
  // rechazada dejaba la campaña excluida del marketplace para siempre. La
  // invitación quedó cerrada, pero la campaña privada sigue disponible y una
  // influencer Pro puede postular por su cuenta (Términos Plan Pro, secc. 6:
  // "Las campañas privadas son visibles para todas las influencers"). Las
  // postulaciones rechazadas por la marca (origin='application') se siguen
  // ocultando igual que antes.
  const excludeIds = (myRows ?? [])
    .filter(r => r.application_status !== 'pending')
    .filter(r => !(r.application_status === 'rejected' && r.origin === 'invitation'))
    .map(r => r.campaign_id as string)

  // Marketplace público: una campaña abierta y activa puede ser descubierta por
  // cualquier influencer. No se restringe a la organización de la marca.
  let query = admin
    .from('campaigns')
    .select(`
      id, name, status, description, type, start_date, end_date, visibility, created_by,
      application_deadline, applications_closed_at, max_influencers, campaign_benefits,
      brand:brands!brand_id (id, name, logo_url, instagram),
      campaign_influencers (id, application_status)
    `)
    .in('visibility', ['open', 'private'])
    .eq('status', 'active')
    .or(`end_date.is.null,end_date.gte.${today}`)
    .order('start_date', { ascending: true })
    .limit(50)

  if (excludeIds.length > 0) {
    query = query.not('id', 'in', `(${excludeIds.join(',')})`)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Campañas personales: creadas por una influencer para sí misma (ver
  // POST /api/influencer/my-campaigns) no son parte del marketplace público
  // — cada influencer ya las ve en su propia sección "Mis campañas". Se
  // excluyen acá reutilizando `created_by` (ya existe en campaigns) contra
  // `influencers.user_id` — misma relación que ya usa
  // /api/influencer/my-campaigns para distinguir self-created.
  const creatorIds = Array.from(new Set((data ?? []).map(c => c.created_by).filter(Boolean))) as string[]
  let influencerCreatorIds = new Set<string>()
  if (creatorIds.length > 0) {
    const { data: influencerCreators } = await admin
      .from('influencers')
      .select('user_id')
      .in('user_id', creatorIds)
    influencerCreatorIds = new Set(
      (influencerCreators ?? []).map(r => r.user_id).filter(Boolean) as string[]
    )
  }
  const marketplaceRows = (data ?? []).filter(c => !influencerCreatorIds.has(c.created_by as string))

  // Fecha del evento para el contador de días de la tarjeta. Solo se lee
  // `starts_at` del booking de campaña (influencer_id null) — la MISMA fecha
  // que el detalle ya entrega antes de postular. No se expone ni dirección ni
  // instrucciones: esas siguen gateadas por application_status.
  const eventStartByCampaign = new Map<string, string>()
  const marketplaceIds = marketplaceRows.map(c => c.id as string)
  if (marketplaceIds.length > 0) {
    const { data: eventBookings } = await admin
      .from('bookings')
      .select('campaign_id, starts_at')
      .in('campaign_id', marketplaceIds)
      .is('influencer_id', null)
      .order('starts_at', { ascending: true })
    for (const booking of eventBookings ?? []) {
      if (booking.campaign_id && booking.starts_at && !eventStartByCampaign.has(booking.campaign_id)) {
        eventStartByCampaign.set(booking.campaign_id, booking.starts_at as string)
      }
    }
  }

  const enriched = marketplaceRows
    .filter(c => {
      // Quien ya postuló conserva la campaña visible con estado "En revisión",
      // aunque la marca cierre después. Para nuevas postulantes se ocultan las
      // campañas cerradas manualmente o sin cupos.
      if (pendingMap.has(c.id)) return true
      if (c.applications_closed_at) return false
      if (c.application_deadline && new Date(c.application_deadline) < new Date()) return false
      const accepted = (c.campaign_influencers ?? []).filter(
        row => row.application_status === 'accepted'
      ).length
      return !c.max_influencers || accepted < c.max_influencers
    })
    .map(c => {
      const { created_by: _createdBy, ...rest } = c
      return {
        ...rest,
        accepted_count: (c.campaign_influencers ?? []).filter(
          row => row.application_status === 'accepted'
        ).length,
        _applied: pendingMap.has(c.id),
        application_status: pendingMap.has(c.id) ? 'pending' : null,
        can_apply: c.visibility === 'open' || isPro,
        requires_pro: c.visibility === 'private' && !isPro,
        event_starts_at: eventStartByCampaign.get(c.id as string) ?? null,
      }
    })

  const covers = await getCampaignCoverUrls(admin, enriched.map(c => c.id))
  return NextResponse.json({ is_pro: isPro, data: enriched.map(c => ({ ...c, cover_url: covers.get(c.id) ?? null })) })
}
