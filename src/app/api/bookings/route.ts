/**
 * GET  /api/bookings           — list bookings for the org
 * POST /api/bookings           — create booking + Google Calendar event + influencer tasks
 * PUT  /api/bookings           — update booking + Google Calendar event
 * DELETE /api/bookings?id=xxx  — cancel booking + remove from Google Calendar
 */

import { NextResponse, type NextRequest } from 'next/server'
import { resolvePhysicalLocation, PhysicalLocationError } from '@/lib/resolvePhysicalLocation'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId, isPlatformAdmin } from '@/lib/supabase/ensureOrg'
import { authorizeCampaignBrandAction } from '@/lib/campaign-brand-access'
import { canonicalBookingLocationForCampaign, mergeBookingLocationDetails } from '@/lib/campaign-locations'
import {
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
} from '@/lib/google-calendar'

/**
 * Organización sobre la que el usuario puede ESCRIBIR bookings, o null.
 *  - Con campaña: admin de plataforma, o marca dueña de la campaña con `campaign.manage`
 *    (owner y brand_manager; `member` y `finance` no) y estado de marca operativo
 *    (lo comprueba hasBrandPermission). Pertenecer a la organización ya no basta.
 *  - Sin campaña: solo admin de plataforma, y dentro de su propia organización.
 */
async function resolveBookingWriteOrg(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  campaignId: string | null,
  actorOrgId: string,
  existingOrgId?: string | null,
) {
  if (campaignId) {
    const auth = await authorizeCampaignBrandAction(userId, campaignId, 'campaign.manage')
    return auth?.campaign.organization_id ?? null
  }
  if (!(await isPlatformAdmin(userId, admin))) return null
  if (existingOrgId !== undefined && existingOrgId !== actorOrgId) return null
  return actorOrgId
}

// ── GET /api/bookings ─────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  // Agenda global de plataforma: ninguna pantalla de marca la consume.
  if (!(await isPlatformAdmin(user.id, admin))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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
    location: clientLocation, location_id: clientLocationId, location_details: clientLocationDetails, is_virtual, virtual_link,
    starts_at, ends_at,
    fee, currency, travel_covered,
    notes, attendee_emails = [],
    timezone = 'America/Mexico_City',
    influencer_ids = [],  // multi-influencer support
  } = body

  const campaignOrgId = await resolveBookingWriteOrg(admin, user.id, campaign_id ? String(campaign_id) : null, orgId)
  if (!campaignOrgId) return NextResponse.json({ error: 'No tienes permiso para editar el evento de esta campaña' }, { status: 403 })

  // Merge influencer_id + influencer_ids into a unified list
  const allInfluencerIds: string[] = Array.from(new Set([
    ...(influencer_id ? [influencer_id as string] : []),
    ...((influencer_ids as string[]) ?? []),
  ])).filter(Boolean)
  const primaryInfluencerId: string | null = allInfluencerIds[0] ?? null

  // Si la campaña ya tiene direcciones canónicas (campaign_locations), el booking
  // general del evento toma la PRINCIPAL; el texto que envíe el cliente se ignora.
  const canonicalLocation = campaign_id && event_type === 'event' && !primaryInfluencerId
    ? await canonicalBookingLocationForCampaign(admin, String(campaign_id))
    : null
  let picked
  try {
    picked = canonicalLocation ? null : await resolvePhysicalLocation(admin, {
      locationId: typeof clientLocationId === 'string' ? clientLocationId : null,
      location: typeof clientLocation === 'string' ? clientLocation : null,
      isVirtual: is_virtual === true,
    })
  } catch (e) {
    if (e instanceof PhysicalLocationError) return NextResponse.json({ error: e.message }, { status: e.status })
    throw e
  }
  const location = canonicalLocation ? canonicalLocation.location : (picked?.locationDisplay ?? clientLocation)
  const location_details = canonicalLocation ? mergeBookingLocationDetails(null, clientLocationDetails, canonicalLocation.details) : clientLocationDetails

  // Idempotencia: si es el booking general de una campaña (sin influencer) y ya
  // existe uno con el mismo horario, no crear un duplicado (evita doble-submit
  // desde el editor de fecha/hora del Admin/Marca creando 2 filas idénticas).
  if (campaign_id && !primaryInfluencerId && starts_at && ends_at) {
    const { data: existingBooking } = await admin
      .from('bookings')
      .select('*')
      .eq('campaign_id', campaign_id)
      .is('influencer_id', null)
      .eq('starts_at', new Date(starts_at).toISOString())
      .eq('ends_at', new Date(ends_at).toISOString())
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (existingBooking) return NextResponse.json(existingBooking, { status: 200 })
  }

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
      organization_id: campaignOrgId,
      created_by: user.id,
      title,
      description,
      event_type,
      location,
      location_id: canonicalLocation?.location_id ?? picked?.locationId ?? null,
      location_details: location_details ?? null,
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
  // campaign_id / organization_id / created_by no se pueden reasignar por PUT: permitirlo dejaría
  // mover un booking a una campaña u organización ajena tras autorizar solo la original.
  const {
    id, title, description, location: clientLocation, location_id: clientLocationId, starts_at, ends_at, timezone,
    campaign_id: _campaignId, organization_id: _organizationId, created_by: _createdBy, calendar_event_id: _calendarEventId,
    ...rest
  } = body

  // Obtain existing to get gcal ID
  const { data: existing } = await admin
    .from('bookings')
    .select('calendar_event_id, campaign_id, organization_id, event_type, influencer_id, location_details')
    .eq('id', id)
    .maybeSingle()

  if (!existing) return NextResponse.json({ error: 'Evento no encontrado' }, { status: 404 })
  const writeOrgId = await resolveBookingWriteOrg(admin, user.id, existing.campaign_id ?? null, orgId, existing.organization_id)
  if (!writeOrgId) return NextResponse.json({ error: 'No tienes permiso para editar este evento' }, { status: 403 })

  // Igual que en POST: con direcciones canónicas, la ubicación del evento sale de la principal.
  const canonicalLocation = existing.campaign_id && existing.event_type === 'event' && !existing.influencer_id
    ? await canonicalBookingLocationForCampaign(admin, existing.campaign_id)
    : null
  let picked
  try {
    picked = canonicalLocation || typeof clientLocationId !== 'string' ? null : await resolvePhysicalLocation(admin, {
      locationId: clientLocationId,
      location: typeof clientLocation === 'string' ? clientLocation : null,
    })
  } catch (e) {
    if (e instanceof PhysicalLocationError) return NextResponse.json({ error: e.message }, { status: e.status })
    throw e
  }
  const location = canonicalLocation ? canonicalLocation.location : (picked?.locationDisplay ?? clientLocation)
  const canonicalFields = canonicalLocation
    ? { location_id: canonicalLocation.location_id, location_details: mergeBookingLocationDetails(existing.location_details, rest.location_details, canonicalLocation.details) }
    : picked ? { location_id: picked.locationId } : {}

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
    .update({ title, description, location, starts_at, ends_at, ...rest, ...canonicalFields, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('organization_id', writeOrgId)
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
    .select('calendar_event_id, campaign_id, organization_id')
    .eq('id', id)
    .maybeSingle()

  if (!existing) return NextResponse.json({ error: 'Evento no encontrado' }, { status: 404 })
  const writeOrgId = await resolveBookingWriteOrg(admin, user.id, existing.campaign_id ?? null, orgId, existing.organization_id)
  if (!writeOrgId) return NextResponse.json({ error: 'No tienes permiso para quitar este evento' }, { status: 403 })

  if (existing?.calendar_event_id) {
    try { await deleteCalendarEvent(existing.calendar_event_id) } catch {}
  }

  const { error } = await admin
    .from('bookings')
    .update({ status: 'canceled', canceled_at: new Date().toISOString() })
    .eq('id', id)
    .eq('organization_id', writeOrgId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
