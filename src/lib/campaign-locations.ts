// Direcciones de campaña = referencias a public.locations (level 'place') vía
// campaign_locations. Este módulo es la ÚNICA fuente de:
//   · cómo se arma una dirección (display / comuna / región / país);
//   · qué ve cada rol (staff completo, influencer redactada hasta ser aceptada);
//   · cómo se sincroniza la dirección principal hacia bookings y campaigns.metadata
//     (consumidores legacy) sin perder el texto histórico.
// Sin imports de servidor: el cliente admin se inyecta, así se prueba en memoria.
import type { SupabaseClient } from '@supabase/supabase-js'

type Admin = SupabaseClient
type BreadcrumbItem = { id: string; name: string; level: string }
type Json = Record<string, unknown>

export const CAMPAIGN_LOCATION_INSTRUCTIONS_MAX = 500

export type CampaignLocation = {
  /** id del vínculo campaign_locations (no del lugar). */
  id: string
  location_id: string
  is_primary: boolean
  sort_order: number
  instructions: string | null
  name: string
  address: string | null
  commune: string | null
  city: string | null
  region: string | null
  country: string | null
  display: string
}

/** Vista pública previa a la aceptación: sin dirección exacta ni indicaciones. */
export type RedactedCampaignLocation = Pick<
  CampaignLocation,
  'is_primary' | 'name' | 'commune' | 'city' | 'region' | 'country'
> & { address_hidden: boolean }

const uniq = (parts: Array<string | null | undefined>) =>
  Array.from(new Set(parts.map(p => (p ?? '').trim()).filter(Boolean)))

/** Texto de una línea. Una sola definición para toda la app. */
export function formatLocationDisplay(parts: { name: string; address: string | null; commune: string | null; region: string | null }): string {
  const geo = uniq([parts.commune, parts.region]).join(', ')
  return uniq([parts.name, parts.address, geo]).join(' · ')
}

export function geographyFromBreadcrumb(breadcrumb: unknown): Pick<CampaignLocation, 'commune' | 'city' | 'region' | 'country'> {
  const items = (Array.isArray(breadcrumb) ? breadcrumb : []) as BreadcrumbItem[]
  const byLevel = (level: string) => items.find(i => i.level === level)?.name ?? null
  return { commune: byLevel('commune'), city: byLevel('city'), region: byLevel('region'), country: byLevel('country') }
}

type LinkRow = { id: string; location_id: string; is_primary: boolean; sort_order: number; instructions: string | null }
type PlaceRow = { id: string; name: string; address: string | null }

/** Principal primero, luego por orden y antigüedad. */
export function sortCampaignLocations<T extends { is_primary: boolean; sort_order: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order)
}

export async function loadCampaignLocations(admin: Admin, campaignId: string): Promise<CampaignLocation[]> {
  const { data: links, error } = await admin
    .from('campaign_locations')
    .select('id, location_id, is_primary, sort_order, instructions')
    .eq('campaign_id', campaignId)
    .order('sort_order')
    .order('created_at')
  if (error) throw new Error(error.message)
  const rows = (links ?? []) as LinkRow[]
  if (!rows.length) return []

  const { data: places, error: placesError } = await admin
    .from('locations')
    .select('id, name, address')
    .in('id', rows.map(r => r.location_id))
  if (placesError) throw new Error(placesError.message)
  const placeById = new Map((places ?? [] as PlaceRow[]).map((p: PlaceRow) => [p.id, p]))

  const out: CampaignLocation[] = []
  for (const row of rows) {
    const place = placeById.get(row.location_id)
    if (!place) continue
    const { data: breadcrumb, error: bcError } = await admin.rpc('location_breadcrumb', { p_id: place.id })
    if (bcError) throw new Error(bcError.message)
    const geo = geographyFromBreadcrumb(breadcrumb)
    out.push({
      id: row.id,
      location_id: row.location_id,
      is_primary: row.is_primary,
      sort_order: row.sort_order,
      instructions: row.instructions,
      name: place.name,
      address: place.address,
      ...geo,
      display: formatLocationDisplay({ name: place.name, address: place.address, commune: geo.commune, region: geo.region }),
    })
  }
  return sortCampaignLocations(out)
}

/**
 * Qué ve una influencer. Misma regla que ya regía para el booking: nombre del
 * lugar y comuna antes de aceptar; dirección exacta e indicaciones solo
 * con application_status = 'accepted'. La decisión se toma en el servidor.
 */
export function locationsForInfluencer(
  locations: CampaignLocation[],
  isAccepted: boolean,
): Array<CampaignLocation | RedactedCampaignLocation> {
  if (isAccepted) return locations
  return locations.map(l => ({
    is_primary: l.is_primary,
    name: l.name,
    commune: l.commune,
    city: l.city,
    region: l.region,
    country: l.country,
    address_hidden: Boolean(l.address),
  }))
}

/** El texto histórico (legacy_location) es de uso interno: nunca llega a la influencer. */
export function stripLegacyLocation(details: unknown): Json | null {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null
  const { legacy_location: _legacy, ...rest } = details as Json
  return rest
}

/**
 * campaigns.metadata hacia una influencer ACEPTADA: conserva todo lo que ya recibía
 * (incluida la dirección vigente) salvo la copia histórica interna `legacy_location`.
 */
export function metadataForInfluencer(metadata: unknown): unknown {
  return stripLegacyLocation(metadata) ?? metadata
}

/** Normaliza el texto de indicaciones; null si viene vacío. */
export function normalizeInstructions(value: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, value: null }
  if (typeof value !== 'string') return { ok: false, error: 'Indicaciones inválidas' }
  const text = value.trim()
  if (text.length > CAMPAIGN_LOCATION_INSTRUCTIONS_MAX) {
    return { ok: false, error: `Las indicaciones no pueden superar ${CAMPAIGN_LOCATION_INSTRUCTIONS_MAX} caracteres` }
  }
  return { ok: true, value: text || null }
}

/** Errores de Postgres (trigger / constraints) → respuestas claras. */
export function campaignLocationDbError(error: { code?: string; message: string }): { status: number; error: string } {
  switch (error.code) {
    case '23505': return { status: 409, error: 'Esa dirección ya está asociada a la campaña.' }
    case '23503': return { status: 422, error: 'La campaña o el lugar no existe.' }
    case '23514': return { status: 422, error: error.message }
    case '22P02': return { status: 400, error: 'Identificador inválido.' }
    default:      return { status: 500, error: error.message }
  }
}

// ── Sincronización hacia consumidores legacy ────────────────────────────────
// La dirección principal es la que muestran bookings (agenda, Google Calendar,
// vista de influencer) y campaigns.metadata (ficha de marca, fallback). Antes
// de sobrescribir por primera vez se guarda el texto original en `legacy`
// para poder restaurarlo si se quitan todas las direcciones.

const META_KEYS = ['address', 'venue_name', 'commune', 'region', 'country', 'location_instructions'] as const

function asJson(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Json) } : {}
}

export function canonicalMetadata(primary: CampaignLocation | null): Json {
  return primary
    ? {
        address: primary.address,
        venue_name: primary.name,
        commune: primary.commune,
        region: primary.region,
        country: primary.country ?? 'Chile',
        location_instructions: primary.instructions,
      }
    : {}
}

export function applyPrimaryToMetadata(current: unknown, primary: CampaignLocation | null): Json {
  const meta = asJson(current)
  if (!primary) {
    const legacy = asJson(meta.legacy_location)
    if (Object.keys(legacy).length) {
      for (const key of META_KEYS) meta[key] = legacy[key] ?? null
      delete meta.legacy_location
    } else {
      for (const key of META_KEYS) meta[key] = null
    }
    return meta
  }
  if (!('legacy_location' in meta)) {
    meta.legacy_location = Object.fromEntries(META_KEYS.map(key => [key, meta[key] ?? null]))
  }
  return { ...meta, ...canonicalMetadata(primary) }
}

/** Campos de ubicación de un booking de evento derivados de la dirección principal. */
export function canonicalBookingFields(primary: CampaignLocation): { location: string | null; location_id: string; details: Json } {
  return {
    location: primary.address,
    location_id: primary.location_id,
    details: {
      venue_name: primary.name,
      commune: primary.commune,
      region: primary.region,
      country: primary.country ?? 'Chile',
      instructions: primary.instructions,
      address_hidden: Boolean(primary.address),
    },
  }
}

export function applyPrimaryToBooking(
  booking: { location: string | null; location_id: string | null; location_details: unknown },
  primary: CampaignLocation | null,
): { location: string | null; location_id: string | null; location_details: Json } {
  const details = asJson(booking.location_details)
  if (!primary) {
    const legacy = asJson(details.legacy_location)
    delete details.legacy_location
    if (Object.keys(legacy).length) {
      const { location: legacyLocation, ...legacyDetails } = legacy
      return { location: (legacyLocation as string | null) ?? null, location_id: null, location_details: { ...details, ...legacyDetails } }
    }
    return { location: null, location_id: null, location_details: { ...details, venue_name: null, commune: null, region: null, instructions: null, address_hidden: false } }
  }
  if (!('legacy_location' in details)) {
    // Un booking que ya trae location_id nació (o fue resuelto) con una dirección canónica: su texto
    // actual NO es histórico, así que no se guarda como tal (si no, al quitar todas las direcciones
    // reaparecería una dirección que ya no corresponde). Solo el texto libre previo es histórico.
    const alreadyCanonical = booking.location_id != null
    details.legacy_location = alreadyCanonical
      ? { location: null, venue_name: null, commune: null, region: null, country: null, instructions: null, address_hidden: false }
      : {
          location: booking.location ?? null,
          venue_name: details.venue_name ?? null,
          commune: details.commune ?? null,
          region: details.region ?? null,
          country: details.country ?? null,
          instructions: details.instructions ?? null,
          address_hidden: details.address_hidden ?? false,
        }
  }
  const canonical = canonicalBookingFields(primary)
  return { location: canonical.location, location_id: canonical.location_id, location_details: { ...details, ...canonical.details } }
}

/**
 * location_details de un booking de evento con direcciones canónicas: se FUSIONA con lo ya
 * guardado (schedule, address_hidden, …) y con lo que envía el cliente; la ubicación la
 * impone la principal. La copia histórica (`legacy_location`) la controla solo el servidor:
 * se conserva la guardada y se descarta cualquiera que envíe el cliente.
 */
export function mergeBookingLocationDetails(existing: unknown, client: unknown, canonical: Json): Json {
  const stored = asJson(existing)
  const merged: Json = { ...stored, ...asJson(client), ...canonical }
  if ('legacy_location' in stored) merged.legacy_location = stored.legacy_location
  else delete merged.legacy_location
  return merged
}

/**
 * Cuando la campaña ya tiene direcciones canónicas, el cliente NO decide la
 * ubicación de sus bookings de evento: se toma de la principal. Devuelve null si
 * la campaña no tiene direcciones (campañas históricas siguen con su texto).
 */
export async function canonicalBookingLocationForCampaign(
  admin: Admin, campaignId: string,
): Promise<{ location: string | null; location_id: string; details: Json } | null> {
  let locations: CampaignLocation[]
  try { locations = await loadCampaignLocations(admin, campaignId) } catch { return null }
  const primary = locations.find(l => l.is_primary)
  return primary ? canonicalBookingFields(primary) : null
}

/**
 * Un PUT de campaña con datos obsoletos (pestaña abierta antes de cambiar la
 * dirección) no puede pisar la dirección canónica: si la campaña ya tiene
 * direcciones (marcador `legacy_location`), las claves de ubicación se
 * conservan tal como están en la base.
 */
export function lockCanonicalLocationMetadata(existing: unknown, incoming: Json): Json {
  const current = asJson(existing)
  if (!('legacy_location' in current)) return incoming
  const locked: Json = { ...incoming, legacy_location: current.legacy_location }
  for (const key of META_KEYS) locked[key] = current[key] ?? null
  return locked
}

/**
 * Tras cualquier cambio de direcciones: copia la principal a los bookings de
 * evento de la campaña y a campaigns.metadata. Lanza si alguna escritura falla
 * (CLAUDE.md 16.1: nunca ignorar `error`).
 */
export async function syncCampaignPrimaryLocation(admin: Admin, campaignId: string, locations?: CampaignLocation[]): Promise<CampaignLocation[]> {
  const all = locations ?? await loadCampaignLocations(admin, campaignId)
  const primary = all.find(l => l.is_primary) ?? null

  const { data: campaign, error: campaignError } = await admin
    .from('campaigns').select('id, metadata').eq('id', campaignId).maybeSingle()
  if (campaignError) throw new Error(campaignError.message)
  if (campaign) {
    const { error } = await admin.from('campaigns')
      .update({ metadata: applyPrimaryToMetadata(campaign.metadata, primary) })
      .eq('id', campaignId)
    if (error) throw new Error(error.message)
  }

  const { data: bookings, error: bookingsError } = await admin
    .from('bookings')
    .select('id, location, location_id, location_details')
    .eq('campaign_id', campaignId)
    .eq('event_type', 'event')
    .is('influencer_id', null)
    .neq('status', 'canceled')
  if (bookingsError) throw new Error(bookingsError.message)
  for (const booking of bookings ?? []) {
    const { error } = await admin.from('bookings')
      .update(applyPrimaryToBooking(booking, primary))
      .eq('id', booking.id)
    if (error) throw new Error(error.message)
  }
  return all
}
