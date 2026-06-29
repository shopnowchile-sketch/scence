/**
 * GET  /api/bookings           — list bookings for the org
 * POST /api/bookings           — create booking + Google Calendar event + influencer tasks
 * PUT  /api/bookings           — update booking + Google Calendar event
 * DELETE /api/bookings?id=xxx  — cancel booking + remove from Google Calendar
 */

import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'
import {
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
} from '@/lib/google-calendar'
import { createInfluencerTasks } from '@/lib/influencer-tasks'

// ── GET /api/bookings ─────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return NextResponse.json({ data: [] })

  const sp       = req.nextUrl.searchParams
  const status   = sp.get('status')
  const fromDate = sp.get('from')
  const toDate   = sp.get('to')
  const limit    = Number(sp.get('limit') ?? '200')

  let query = admin
    .from('bookings')
    .select(`*, influencer:influencers (id, display_name, avatar_url), campaign:campaigns (id, name)`)
    .eq('organization_id', orgId)
    .order('starts_at', { ascending: true })
    .limit(limit)

  if (status)   query = query.eq('status', status)
  if (fromDate) query = query.gte('starts_at', fromDate)
  if (toDate)   query = query.lte('starts_at', toDate)

  const { data, error } = await query
  if (error) { console.error('[GET /api/bookings]', error); return NextResponse.json({ error: error.message }, { status: 500 }) }

  const bookings = data ?? []

  // Fetch booking_influencers separately (avoids schema cache FK issue)
  if (bookings.length > 0) {
    const bookingIds = bookings.map(b => b.id)
    const { data: biData } = await admin
      .from('booking_influencers')
      .select('id, booking_id, influencer_id, status, influencer:influencers(id, display_name, avatar_url)')
      .in('booking_id', bookingIds)

    const biByBooking: Record<string, unknown[]> = {}
    for (const bi of biData ?? []) {
      const bid = (bi as Record<string, unknown>).booking_id as string
      if (!biByBooking[bid]) biByBooking[bid] = []
      biByBooking[bid].push(bi)
    }

    const enriched = bookings.map(b => ({ ...b, booking_influencers: biByBooking[b.id] ?? [] }))
    return NextResponse.json({ data: enriched })
  }

  return NextResponse.json({ data: bookings })
}

// ── POST /api/bookings ────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return NextResponse.json({ error: 'No organization found' }, { status: 404 })

  const body = await req.json()
  const {
    campaign_id, influencer_id, organization_id,
    title, description, event_type,
    location, is_virtual, virtual_link,
    starts_at, ends_at,
    fee, currency, travel_covered,
    notes, attendee_emails = [],
    timezone = 'America/Mexico_City',
    influencer_ids = [],  // multi-influencer support
  } = body

  // Merge influencer_id + influencer_ids into a unified list
  const allInfluencerIds: string[] = Array.from(new Set([
    ...(influencer_id ? [influencer_id as string] : []),
    ...((influencer_ids as string[]) ?? []),
  ])).filter(Boolean)
  const primaryInfluencerId: string | null = allInfluencerIds[0] ?? null

  // 1. Crear en Google Calendar
  let gcalEventId: string | null = null
  let gcalLink: string | null = null

  try {
    const gcalEvent = await createCalendarEvent({
      title,
      description: description
        ? `${description}\n\nEvento SCENCE — ${event_type ?? 'Booking'}`
        : `Evento SCENCE — ${event_type ?? 'Booking'}`,
      location: location ?? (is_virtual ? virtual_link : undefined),
      startsAt: new Date(starts_at),
      endsAt: new Date(ends_at),
      attendeeEmails: attendee_emails,
      timeZone: timezone,
    })
    gcalEventId = gcalEvent.id
    gcalLink = gcalEvent.htmlLink ?? null
  } catch (e) {
    console.error('Google Calendar error (non-fatal):', e)
    // No bloqueamos la creación del booking si Calendar falla
  }

  // 2. Insertar en Supabase
  const { data, error } = await admin
    .from('bookings')
    .insert({
      campaign_id: campaign_id ?? null,
      influencer_id: primaryInfluencerId,
      organization_id: orgId,
      created_by: user.id,
      title,
      description,
      event_type,
      location,
      is_virtual: is_virtual ?? false,
      virtual_link,
      starts_at,
      ends_at,
      fee,
      currency: currency ?? 'CLP',
      travel_covered: travel_covered ?? false,
      notes,
      status: 'proposed',
      calendar_event_id: gcalEventId,
      metadata: gcalLink ? { google_calendar_link: gcalLink } : {},
    })
    .select('*')
    .single()

  if (error) {
    // Si el booking falla pero ya creamos el evento, intentar borrarlo
    if (gcalEventId) {
      try { await deleteCalendarEvent(gcalEventId) } catch {}
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // ── Insert all influencers into booking_influencers (multi-influencer) ──────
  if (data?.id && allInfluencerIds.length > 0) {
    try {
      await admin.from('booking_influencers').insert(
        allInfluencerIds.map(infId => ({
          booking_id:    data.id,
          influencer_id: infId,
          status:        'invited',
        }))
      )
    } catch (e) {
      console.error('[booking_influencers insert] non-fatal:', e)
    }
  }

  // ── Auto-generate influencer tasks ────────────────────────────────────────
  for (const infId of allInfluencerIds) {
    try {
      await createInfluencerTasks(admin, {
        organizationId: orgId,
        influencerId:   infId,
        sourceType:     'booking',
        sourceId:       data.id,
        sourceDate:     starts_at,
      })
    } catch (e) {
      console.error('[booking auto-tasks] failed for', infId, e)
    }
  }

  return NextResponse.json(data, { status: 201 })
}

// ── PUT /api/bookings ─────────────────────────────────────────────────────────
export async function PUT(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return NextResponse.json({ error: 'No organization found' }, { status: 404 })

  const body = await req.json()
  const { id, title, description, location, starts_at, ends_at, timezone, ...rest } = body

  // Obtain existing to get gcal ID
  const { data: existing } = await admin
    .from('bookings')
    .select('calendar_event_id')
    .eq('id', id)
    .eq('organization_id', orgId)
    .single()

  if (existing?.calendar_event_id) {
    try {
      await updateCalendarEvent(existing.calendar_event_id, {
        title, description, location,
        startsAt: starts_at ? new Date(starts_at) : undefined,
        endsAt: ends_at ? new Date(ends_at) : undefined,
        timeZone: timezone,
      })
    } catch (e) {
      console.error('Google Calendar update error (non-fatal):', e)
    }
  }

  const { data, error } = await admin
    .from('bookings')
    .update({ title, description, location, starts_at, ends_at, ...rest, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('organization_id', orgId)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// ── DELETE /api/bookings?id=xxx ───────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return NextResponse.json({ error: 'No organization found' }, { status: 404 })

  const { data: existing } = await admin
    .from('bookings')
    .select('calendar_event_id')
    .eq('id', id)
    .eq('organization_id', orgId)
    .single()

  if (existing?.calendar_event_id) {
    try { await deleteCalendarEvent(existing.calendar_event_id) } catch {}
  }

  const { error } = await admin
    .from('bookings')
    .update({ status: 'canceled', canceled_at: new Date().toISOString() })
    .eq('id', id)
    .eq('organization_id', orgId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
