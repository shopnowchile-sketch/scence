import { NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'

// GET /api/influencer/campaigns/open
// Returns active campaigns the influencer is NOT yet part of (open to apply)
export async function GET() {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: influencer } = await admin
    .from('influencers')
    .select('id, organization_id')
    .eq('user_id', user.id)
    .single()

  if (!influencer) return NextResponse.json({ error: 'Not an influencer account' }, { status: 403 })

  // Campañas donde la influencer ya tiene alguna relación (invitada, postulando, aceptada, etc.)
  const { data: myRows } = await admin
    .from('campaign_influencers')
    .select('campaign_id, application_status')
    .eq('influencer_id', influencer.id)

  // Las que siguen "pendiente" se DEJAN ver en Disponibles (con badge de
  // "en revisión") en vez de desaparecer — pedido por Pri, 2026-07-01:
  // antes, apenas postulaba, la campaña se iba de la lista en el próximo
  // refresh y no quedaba ningún rastro visible de la postulación.
  const pendingMap = new Map(
    (myRows ?? [])
      .filter(r => r.application_status === 'pending')
      .map(r => [r.campaign_id as string, true])
  )
  const excludeIds = (myRows ?? [])
    .filter(r => r.application_status !== 'pending')
    .map(r => r.campaign_id as string)

  // Campañas open de la misma org — activas o buscando influencers, sin deadline vencida
  const today = new Date().toISOString().split('T')[0]
  let query = admin
    .from('campaigns')
    .select(`
      id, name, status, description, type, start_date, end_date, visibility,
      application_deadline, max_influencers,
      brand:brands!brand_id (id, name, logo_url),
      campaign_influencers (id)
    `)
    .eq('organization_id', influencer.organization_id)
    .eq('visibility', 'open')
    .in('status', ['draft', 'pending_approval', 'active'])
    .or(`application_deadline.is.null,application_deadline.gte.${today}`)
    .order('start_date', { ascending: true })
    .limit(50)

  if (excludeIds.length > 0) {
    query = query.not('id', 'in', `(${excludeIds.join(',')})`)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const enriched = (data ?? []).map(c => ({
    ...c,
    _applied: pendingMap.has(c.id),
    application_status: pendingMap.has(c.id) ? 'pending' : null,
  }))

  return NextResponse.json({ data: enriched })
}
