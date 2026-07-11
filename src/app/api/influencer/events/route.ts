import { NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'

// GET /api/influencer/events
// Returns upcoming bookings + events linked to this influencer.
export async function GET() {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: influencer } = await admin
    .from('influencers')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!influencer) return NextResponse.json({ error: 'Not an influencer account' }, { status: 403 })

  const now = new Date().toISOString()

  // Campañas de la influencer con su estado: se ocultan eventos/bookings de
  // campañas en borrador/revisión (preasignación no activada). Los eventos o
  // bookings SIN campaña (standalone) NO se filtran.
  const { data: ciRows } = await admin
    .from('campaign_influencers')
    .select('campaign_id, campaign:campaigns (status)')
    .eq('influencer_id', influencer.id)

  const HIDDEN = new Set(['draft', 'pending_approval'])
  const hiddenCampaignIds = new Set<string>(
    (ciRows ?? [])
      .filter(r => HIDDEN.has(String((r.campaign as unknown as { status?: string } | null)?.status ?? '')))
      .map(r => r.campaign_id as string)
  )
  const visibleCampaignIds = Array.from(new Set(
    (ciRows ?? [])
      .map(r => r.campaign_id as string)
      .filter(id => id && !hiddenCampaignIds.has(id))
  ))

  // Upcoming bookings for this influencer (se incluye campaign_id para gatear)
  const { data: bookings } = await admin
    .from('bookings')
    .select('id, title, starts_at, ends_at, status, location, is_virtual, virtual_link, event_type, campaign_id')
    .eq('influencer_id', influencer.id)
    .gte('starts_at', now)
    .not('status', 'eq', 'canceled')
    .order('starts_at', { ascending: true })
    .limit(10)

  // Se ocultan bookings de campañas draft/pending_approval; los standalone
  // (campaign_id null) se mantienen.
  const visibleBookings = (bookings ?? []).filter((b: { campaign_id?: string | null }) =>
    !b.campaign_id || !hiddenCampaignIds.has(b.campaign_id)
  )

  // Upcoming events — solo de campañas visibles (excluye draft/pending_approval)
  let events: unknown[] = []
  if (visibleCampaignIds.length > 0) {
    const { data: evtData } = await admin
      .from('events')
      .select('id, name, event_date, location, is_virtual, virtual_link, status')
      .in('campaign_id', visibleCampaignIds)
      .gte('event_date', now)
      .not('status', 'eq', 'canceled')
      .order('event_date', { ascending: true })
      .limit(10)
    events = evtData ?? []
  }

  return NextResponse.json({
    bookings: visibleBookings,
    events,
  })
}
