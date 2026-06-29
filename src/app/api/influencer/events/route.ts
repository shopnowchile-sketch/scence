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

  // Upcoming bookings for this influencer
  const { data: bookings } = await admin
    .from('bookings')
    .select('id, title, starts_at, ends_at, status, location, is_virtual, virtual_link, event_type')
    .eq('influencer_id', influencer.id)
    .gte('starts_at', now)
    .not('status', 'eq', 'canceled')
    .order('starts_at', { ascending: true })
    .limit(10)

  // Upcoming events (from campaigns this influencer is in)
  const { data: campaignIds } = await admin
    .from('campaign_influencers')
    .select('campaign_id')
    .eq('influencer_id', influencer.id)

  const ids = (campaignIds ?? []).map((r: { campaign_id: string }) => r.campaign_id)

  let events: unknown[] = []
  if (ids.length > 0) {
    const { data: evtData } = await admin
      .from('events')
      .select('id, name, event_date, location, is_virtual, virtual_link, status')
      .in('campaign_id', ids)
      .gte('event_date', now)
      .not('status', 'eq', 'canceled')
      .order('event_date', { ascending: true })
      .limit(10)
    events = evtData ?? []
  }

  return NextResponse.json({
    bookings: bookings ?? [],
    events,
  })
}
