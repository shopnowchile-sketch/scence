/**
 * GET  /api/bookings           — list bookings for the org
 * POST /api/bookings           — create booking + Google Calendar event + influencer tasks
 * PUT  /api/bookings           — update booking + Google Calendar event
 * DELETE /api/bookings?id=xxx  — cancel booking + remove from Google Calendar
 */

import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId, getUserRole } from '@/lib/supabase/ensureOrg'
import { resolvePhysicalLocation, PhysicalLocationError } from '@/lib/resolvePhysicalLocation'
import {
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
} from '@/lib/google-calendar'

async function resolveCampaignWriteOrg(
  admin: ReturnType<typeof createAdminClient>,
  user: { id: string; user_metadata?: Record<string, unknown> },
  campaignId: string,
  actorOrgId: string,
) {
  const { data: campaign } = await admin
    .from('campaigns')
    .select('organization_id')
    .eq('id', campaignId)
    .maybeSingle()
  if (!campaign?.organization_id) return null
  if (campaign.organization_id === actorOrgId) return campaign.organization_id

  const { isAdmin } = await getUserRole(user.id, actorOrgId, admin)
  return isAdmin ? campaign.organization_id : null
}

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
    .select(`*, influencer:influencers (id, display_name, avatar_url), campaign:campaigns (id, name, location_id), location:locations (id, name, address, level, type, is_private, is_active)`)
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
    location, location_id, location_details, is_virtual, virtual_link,
    starts_at, ends_at,
    fee, currency, travel_covered,
    notes, attendee_emails = [],
    timezone = 'America/Mexico_City',
    influencer_ids = [],  // multi-influencer support
  } = body

  const campaignOrgId = campaign_id
    ? await resolveCampaignWriteOrg(admin, user, String(campaign_id), orgId)
    : orgId
  if (!campaignOrgId) return NextResponse.json({ error: 'No tienes permiso para editar el evento de esta campaña' }, { status: 403 })

  // Merge influencer_id + influencer_ids into a unified list
  const allInfluencerIds: string[] = Array.from(new Set([
    ...(influencer_id ? [influencer_id as string] : []),
    ...((influencer_ids as string[]) ?? []),
  ])).filter(Boolean)
  const primaryInfluencerId: string | null = allInfluencerIds[0] ?? null

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

  let inheritedCampaignLocationId: string | null = null
  if (campaign_id && !location_id && !is_virtual) {
    const { data: campaign } = await admin
      .from('campaigns')
      .select('location_id')
      .eq('id', campaign_id)
      .maybeSingle()
    inheritedCampaignLocationId = campaign?.location_id ?? null
  }

  let canonicalLocationId: string | null = null
  let canonicalLocation: string | null = null
  if (!is_virtual) {
    try {
      const resolvedLocation = await resolvePhysicalLocation(admin, {
        locationId: location_id ?? inheritedCampaignLocationId ?? null,
        venueName: typeof location_details?.venue_name === 'string' ? location_details.venue_name : null,
        address: location ?? null,
        commune: typeof location_details?.commune === 'string' ? location_details.commune : null,
        region: typeof location_details?.region === 'string' ? location_details.region : null,
        country: typeof location_details?.country === 'string' ? location_details.country : null,
        organizationId: campaignOrgId,
      })
      if (resolvedLocation.matchType === 'ambiguous') {
        return NextResponse.json({ error: 'La ubicación coincide con más de un lugar. Selecciona una Location existente.' }, { status: 409 })
      }
      const hasLocationInput = Boolean(
        location_id ||
        inheritedCampaignLocationId ||
        (typeof location === 'string' && location.trim()) ||
        (location_details && typeof location_details === 'object' && ['venue_name', 'commune', 'region', 'country'].some(key => typeof location_details[key] === 'string' && location_details[key].trim()))
      )
      if (resolvedLocation.matchType === 'insufficient_data' && hasLocationInput) {
        return NextResponse.json({ error: 'Faltan datos suficientes para identificar la ubicación física.' }, { status: 422 })
      }
      canonicalLocationId = resolvedLocation.locationId
      if (canonicalLocationId) {
        const { data: canonical } = await admin.from('locations').select('name, address').eq('id', canonicalLocationId).single()
        canonicalLocation = canonical?.address ?? canonical?.name ?? null
      }
    } catch (error) {
      if (error instanceof PhysicalLocationError) {
        return NextResponse.json({ error: error.message }, { status: error.status })
      }
      throw error
    }
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
      location: canonicalLocation ?? (is_virtual ? virtual_link : undefined),
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
      location: canonicalLocation,
      location_id: canonicalLocationId,
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
  const { id, title, description, location, location_id, location_details, starts_at, ends_at, timezone, ...rest } = body

  // Obtain existing to get gcal ID
  const { data: existing } = await admin
    .from('bookings')
    .select('calendar_event_id, campaign_id, organization_id, location_id, location_details, location, is_virtual')
    .eq('id', id)
    .maybeSingle()

  if (!existing) return NextResponse.json({ error: 'Evento no encontrado' }, { status: 404 })
  const writeOrgId = existing.campaign_id
    ? await resolveCampaignWriteOrg(admin, user, existing.campaign_id, orgId)
    : (existing.organization_id === orgId ? orgId : null)
  if (!writeOrgId) return NextResponse.json({ error: 'No tienes permiso para editar este evento' }, { status: 403 })

  let canonicalLocationId = existing.location_id ?? null
  let canonicalLocation = typeof location === 'string' ? location : existing.location ?? null
  if (Object.prototype.hasOwnProperty.call(body, 'location_id') || location !== undefined || location_details !== undefined) {
    let campaignLocationId: string | null = null
    if (existing.campaign_id && !location_id && !existing.is_virtual) {
      const { data: campaign } = await admin.from('campaigns').select('location_id').eq('id', existing.campaign_id).maybeSingle()
      campaignLocationId = campaign?.location_id ?? null
    }
    try {
      const resolved = await resolvePhysicalLocation(admin, {
        locationId: typeof location_id === 'string' ? location_id : campaignLocationId,
        venueName: typeof location_details?.venue_name === 'string' ? location_details.venue_name : null,
        address: typeof location === 'string' ? location : null,
        commune: typeof location_details?.commune === 'string' ? location_details.commune : null,
        region: typeof location_details?.region === 'string' ? location_details.region : null,
        country: typeof location_details?.country === 'string' ? location_details.country : null,
        organizationId: writeOrgId,
      })
      if (resolved.matchType === 'ambiguous') return NextResponse.json({ error: 'La ubicación coincide con más de un lugar. Selecciona una Location existente.' }, { status: 409 })
      if (resolved.matchType === 'insufficient_data' && !existing.is_virtual) return NextResponse.json({ error: 'Faltan datos suficientes para identificar la ubicación física.' }, { status: 422 })
      canonicalLocationId = resolved.locationId
      if (canonicalLocationId) {
        const { data: canonical } = await admin.from('locations').select('name, address').eq('id', canonicalLocationId).single()
        canonicalLocation = canonical?.address ?? canonical?.name ?? canonicalLocation
      } else if (existing.is_virtual) {
        canonicalLocation = null
      }
    } catch (error) {
      if (error instanceof PhysicalLocationError) return NextResponse.json({ error: error.message }, { status: error.status })
      throw error
    }
  }

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
    .update({ title, description, location: canonicalLocation, location_id: canonicalLocationId, location_details: location_details ?? existing.location_details ?? null, starts_at, ends_at, ...rest, updated_at: new Date().toISOString() })
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
  const writeOrgId = existing.campaign_id
    ? await resolveCampaignWriteOrg(admin, user, existing.campaign_id, orgId)
    : (existing.organization_id === orgId ? orgId : null)
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
