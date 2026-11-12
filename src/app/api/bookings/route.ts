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
  isGoogleCalendarEnabled,
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
  allowOnboardingDraft = false,
) {
  if (campaignId) {
    const auth = await authorizeCampaignBrandAction(userId, campaignId, 'campaign.manage', { allowOnboardingDraft })
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
    .select(`*, influencer:influencers (id, user_name, avatar_url), campaign:campaigns (id, name)`)
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
      .select('id, booking_id, influencer_id, status, influencer:influencers(id, user_name, avatar_url)')
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

  const isDraftEvent = event_type === 'event' && !influencer_id && Array.isArray(influencer_ids) && influencer_ids.length === 0
    && Array.isArray(attendee_emails) && attendee_emails.length === 0
  const campaignOrgId = await resolveBookingWriteOrg(admin, user.id, campaign_id ? String(campaign_id) : null, orgId, undefined, isDraftEvent)
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

  // Google Calendar desactivado por defecto (ver isGoogleCalendarEnabled): la reserva se crea igual, sin evento ni invitaciones.
  if (isGoogleCalendarEnabled()) try {
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
      const { error: biError } = await admin.from('booking_influencers').insert(
        allInfluencerIds.map(infId => ({
          booking_id:    data.id,
          influencer_id: infId,
          status:        'invited',
        }))
      )
      // supabase-js no lanza: antes un fallo aquí pasaba en silencio y la reserva quedaba sin sus influencers.
      if (biError) {
        console.error('[booking_influencers insert] non-fatal:', biError)
        return NextResponse.json({ ...data, warning: 'La reserva se creó, pero no se pudieron vincular las influencers. Revisa la reserva.' }, { status: 201 })
      }
    } catch (e) {
      console.error('[booking_influencers insert] non-fatal:', e)
    }
  }

  return NextResponse.json(data, { status: 201 })
}

// ── PUT /api/bookings ─────────────────────────────────────────────────────────
// Lista blanca de escritura (antes `...rest` mandaba el body completo al UPDATE: un cliente con permiso sobre la
// campaña podía reescribir influencer_id, confirmation_token/confirmation_status, confirmed_at, canceled_at,
// internal_notes, metadata, fee/currency/travel_budget, etc.). Solo estas claves se escriben; el resto se ignora.
//  - Generales (quien tenga permiso sobre la reserva): título, descripción, fechas, ubicación, notas, enlace, etc.
//  - RESTRINGIDAS (solo admin de plataforma): fee, currency, travel_budget, internal_notes y status. Una marca,
//    aunque administre la campaña, recibe 403 si las envía.
//  - `status` solo admite proposed/confirmed/completed/no_show. Cancelar NO se hace por aquí: usa DELETE
//    (marca canceled + canceled_at y retira el evento de calendario). La confirmación de la influencer sigue
//    su propio flujo (/api/bookings/confirm con enlace firmado).
// NO están: campaign_id, organization_id, created_by, calendar_event_id (propiedad), influencer_id, event_type,
// tokens/estado de confirmación, canceled_at/cancellation_reason, metadata, wardrobe_provided.
const BOOKING_STATUSES = ['proposed', 'confirmed', 'completed', 'no_show'] as const
const BOOKING_CURRENCIES = ['USD', 'EUR', 'MXN', 'CLP', 'COP', 'ARS', 'BRL', 'GBP'] as const
const BOOKING_PUT_EXTRA_FIELDS = ['location_details', 'is_virtual', 'virtual_link', 'notes', 'travel_covered'] as const
const BOOKING_PUT_RESTRICTED_FIELDS = ['status', 'fee', 'currency', 'travel_budget', 'internal_notes'] as const

type BookingPatchResult = { ok: true; extras: Record<string, unknown> } | { ok: false; error: string }

const isTextOrNull = (v: unknown, max: number) => v === null || (typeof v === 'string' && v.length <= max)
const isAmountOrNull = (v: unknown, max: number) => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max)
const hasField = (body: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(body, k) && body[k] !== undefined

/** Valida los tipos de los campos editables presentes en el body (los ausentes no se tocan). */
function validateBookingPatch(body: Record<string, unknown>): BookingPatchResult {
  const has = (k: string) => hasField(body, k)
  if (has('title') && (typeof body.title !== 'string' || !body.title.trim() || body.title.length > 200)) return { ok: false, error: 'El título no es válido' }
  if (has('description') && !isTextOrNull(body.description, 5000)) return { ok: false, error: 'La descripción no es válida' }
  if (has('location') && !isTextOrNull(body.location, 500)) return { ok: false, error: 'La ubicación no es válida' }
  if (has('location_id') && !isTextOrNull(body.location_id, 64)) return { ok: false, error: 'El identificador de lugar no es válido' }
  if (has('timezone') && (typeof body.timezone !== 'string' || body.timezone.length > 64)) return { ok: false, error: 'La zona horaria no es válida' }
  for (const k of ['starts_at', 'ends_at']) {
    if (has(k) && (typeof body[k] !== 'string' || Number.isNaN(new Date(body[k] as string).getTime()))) return { ok: false, error: 'La fecha no es válida' }
  }
  const extras: Record<string, unknown> = {}
  for (const k of [...BOOKING_PUT_EXTRA_FIELDS, ...BOOKING_PUT_RESTRICTED_FIELDS]) if (has(k)) extras[k] = body[k]
  if ('status' in extras) {
    if (extras.status === 'canceled') return { ok: false, error: 'Para cancelar una reserva usa la acción Cancelar' }
    if (!(BOOKING_STATUSES as readonly unknown[]).includes(extras.status)) return { ok: false, error: 'El estado no es válido' }
  }
  if ('fee' in extras && !isAmountOrNull(extras.fee, 9_999_999_999)) return { ok: false, error: 'El honorario no es válido' }
  if ('travel_budget' in extras && !isAmountOrNull(extras.travel_budget, 99_999_999)) return { ok: false, error: 'El presupuesto de viaje no es válido' }
  if ('currency' in extras && !(BOOKING_CURRENCIES as readonly unknown[]).includes(extras.currency)) return { ok: false, error: 'La moneda no es válida' }
  if ('internal_notes' in extras && !isTextOrNull(extras.internal_notes, 5000)) return { ok: false, error: 'Las notas internas no son válidas' }
  for (const k of ['is_virtual', 'travel_covered']) if (k in extras && typeof extras[k] !== 'boolean') return { ok: false, error: 'Valor no válido' }
  if ('virtual_link' in extras && !isTextOrNull(extras.virtual_link, 2000)) return { ok: false, error: 'El enlace no es válido' }
  if ('notes' in extras && !isTextOrNull(extras.notes, 5000)) return { ok: false, error: 'Las notas no son válidas' }
  if ('location_details' in extras) {
    const ld = extras.location_details
    if (ld !== null && (typeof ld !== 'object' || Array.isArray(ld))) return { ok: false, error: 'El detalle de ubicación no es válido' }
  }
  return { ok: true, extras }
}

export async function PUT(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return NextResponse.json({ error: 'No organization found' }, { status: 404 })

  const raw = await req.json().catch(() => null)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return NextResponse.json({ error: 'Cuerpo no válido' }, { status: 400 })
  const body = raw as Record<string, unknown>
  const id = body.id
  if (typeof id !== 'string' || !id) return NextResponse.json({ error: 'Falta el id del evento' }, { status: 400 })

  // Obtain existing to get gcal ID
  const { data: existing, error: existingError } = await admin
    .from('bookings')
    .select('calendar_event_id, campaign_id, organization_id, event_type, influencer_id, location_details, starts_at, ends_at')
    .eq('id', id)
    .maybeSingle()

  if (existingError) { console.error('[PUT /api/bookings] lectura', existingError); return NextResponse.json({ error: 'No se pudo leer el evento' }, { status: 500 }) }
  if (!existing) return NextResponse.json({ error: 'Evento no encontrado' }, { status: 404 })

  // Primero la autorización (propiedad), después la validación: un rol sin permiso recibe 403 con cualquier body.
  const sendsRestricted = BOOKING_PUT_RESTRICTED_FIELDS.some(k => hasField(body, k))
  const isDraftEvent = existing.event_type === 'event' && !existing.influencer_id
    && !sendsRestricted && !BOOKING_PUT_EXTRA_FIELDS.some(k => hasField(body, k))
  const writeOrgId = await resolveBookingWriteOrg(admin, user.id, existing.campaign_id ?? null, orgId, existing.organization_id, isDraftEvent)
  if (!writeOrgId) return NextResponse.json({ error: 'No tienes permiso para editar este evento' }, { status: 403 })
  // Estado y campos financieros/internos: solo admin de plataforma (una marca con permiso sobre la campaña no los toca).
  if (sendsRestricted && !(await isPlatformAdmin(user.id, admin))) {
    return NextResponse.json({ error: 'Solo el equipo de SCENCE puede cambiar el estado, los montos o las notas internas de una reserva' }, { status: 403 })
  }

  const validated = validateBookingPatch(body)
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 422 })
  const { title, description, location: clientLocation, location_id: clientLocationId, starts_at, ends_at, timezone } = body as {
    title?: string; description?: string | null; location?: string | null; location_id?: string | null
    starts_at?: string; ends_at?: string; timezone?: string
  }
  const effectiveStart = starts_at ?? existing.starts_at
  const effectiveEnd = ends_at ?? existing.ends_at
  if (effectiveStart && effectiveEnd && new Date(effectiveEnd).getTime() < new Date(effectiveStart).getTime()) {
    return NextResponse.json({ error: 'El término no puede ser anterior al inicio' }, { status: 422 })
  }

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
    ? { location_id: canonicalLocation.location_id, location_details: mergeBookingLocationDetails(existing.location_details, validated.extras.location_details as Record<string, unknown> | null | undefined, canonicalLocation.details) }
    : picked ? { location_id: picked.locationId } : {}

  const patch: Record<string, unknown> = { ...validated.extras }
  if (title !== undefined) patch.title = title
  if (description !== undefined) patch.description = description
  if (location !== undefined) patch.location = location
  if (starts_at !== undefined) patch.starts_at = starts_at
  if (ends_at !== undefined) patch.ends_at = ends_at
  Object.assign(patch, canonicalFields, { updated_at: new Date().toISOString() })

  const { data, error } = await admin
    .from('bookings')
    .update(patch)
    .eq('id', id)
    .eq('organization_id', writeOrgId)
    .select('*')
    .maybeSingle()

  if (error) { console.error('[PUT /api/bookings] update', error); return NextResponse.json({ error: 'No se pudo actualizar el evento' }, { status: 500 }) }
  if (!data) return NextResponse.json({ error: 'Evento no encontrado' }, { status: 404 })

  // Calendar después de guardar: si la escritura falla no queda el evento externo cambiado sin el registro.
  if (existing.calendar_event_id && isGoogleCalendarEnabled()) {
    try {
      await updateCalendarEvent(existing.calendar_event_id, {
        title, description: description ?? undefined, location: location ?? undefined,
        startsAt: starts_at ? new Date(starts_at) : undefined,
        endsAt: ends_at ? new Date(ends_at) : undefined,
        timeZone: timezone,
      })
    } catch (e) {
      console.error('Google Calendar update error (non-fatal):', e)
    }
  }

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
    .select('calendar_event_id, campaign_id, organization_id, event_type, influencer_id')
    .eq('id', id)
    .maybeSingle()

  if (!existing) return NextResponse.json({ error: 'Evento no encontrado' }, { status: 404 })
  const isDraftEvent = existing.event_type === 'event' && !existing.influencer_id
  const writeOrgId = await resolveBookingWriteOrg(admin, user.id, existing.campaign_id ?? null, orgId, existing.organization_id, isDraftEvent)
  if (!writeOrgId) return NextResponse.json({ error: 'No tienes permiso para quitar este evento' }, { status: 403 })

  if (existing?.calendar_event_id && isGoogleCalendarEnabled()) {
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
