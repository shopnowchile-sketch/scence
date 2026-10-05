import type { SupabaseClient } from '@supabase/supabase-js'
import { isUuid } from './locations'

export type PhysicalLocationInput = {
  locationId?: string | null
  venueName?: string | null
  address?: string | null
  commune?: string | null
  city?: string | null
  region?: string | null
  country?: string | null
  /** Internal server-only context used when a new place must be created. */
  organizationId?: string | null
  createIfMissing?: boolean
}

export type PhysicalLocationMatchType = 'existing' | 'new' | 'ambiguous' | 'insufficient_data'

export type ResolvePhysicalLocationResult = {
  locationId: string | null
  matchType: PhysicalLocationMatchType
}

type LocationNode = {
  id: string
  parent_id: string | null
  level: string
  name: string
  address: string | null
  type: string | null
  brand_id: string | null
  is_private: boolean
  is_active: boolean
}

type PlaceContext = LocationNode & {
  country: string | null
  region: string | null
  city: string | null
  commune: string | null
}

export class PhysicalLocationError extends Error {
  status: number
  constructor(message: string, status = 422) {
    super(message)
    this.name = 'PhysicalLocationError'
    this.status = status
  }
}

/** Geography normalization. Does not replace the database's locations_norm(). */
export function normalizeGeography(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Physical normalization: accents + punctuation + common Chilean address abbreviations. */
export function normalizePhysicalText(value: unknown): string {
  return normalizeGeography(value)
    .replace(/[º°#]/g, ' ')
    .replace(/[.,;:/\\|()[\]{}_-]+/g, ' ')
    .replace(/\b(av|avda|avenida)\b/g, ' avenida ')
    .replace(/\b(pje|pasaje)\b/g, ' pasaje ')
    .replace(/\b(n|nro|numero)\b/g, ' ')
    .replace(/\b(of|ofic|oficina)\b/g, ' oficina ')
    .replace(/\b(depto|dpto|departamento)\b/g, ' depto ')
    .replace(/\s+/g, ' ')
    .trim()
}

function sameProvidedValue(input: string | null | undefined, stored: string | null | undefined, normalize = normalizeGeography) {
  if (!input?.trim()) return true
  if (!stored?.trim()) return false
  return normalize(input) === normalize(stored)
}

function contextForNode(node: LocationNode, byId: Map<string, LocationNode>): PlaceContext {
  let country: string | null = null
  let region: string | null = null
  let city: string | null = null
  let commune: string | null = null
  const seen = new Set<string>()
  let current: LocationNode | undefined = node

  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    if (current.level === 'country') country = current.name
    if (current.level === 'region') region = current.name
    if (current.level === 'city') city = current.name
    if (current.level === 'commune') commune = current.name
    current = current.parent_id ? byId.get(current.parent_id) : undefined
  }

  return { ...node, country, region, city, commune }
}

function compatible(candidate: PlaceContext, input: PhysicalLocationInput) {
  return (
    sameProvidedValue(input.country, candidate.country) &&
    sameProvidedValue(input.region, candidate.region) &&
    sameProvidedValue(input.city, candidate.city) &&
    sameProvidedValue(input.commune, candidate.commune)
  )
}

function enoughToCreate(input: PhysicalLocationInput) {
  return Boolean(
    input.address?.trim() &&
    input.commune?.trim() &&
    input.organizationId &&
    isUuid(input.organizationId),
  )
}

function findUniqueCommuneId(rows: LocationNode[], input: PhysicalLocationInput): string | null | 'ambiguous' {
  const byId = new Map(rows.map(row => [row.id, row]))
  const communes = rows
    .filter(row => row.level === 'commune' && row.is_active)
    .map(row => contextForNode(row, byId))
    .filter(row => sameProvidedValue(input.commune, row.commune))
    .filter(row => sameProvidedValue(input.city, row.city))
    .filter(row => sameProvidedValue(input.region, row.region))
    .filter(row => sameProvidedValue(input.country, row.country))

  const ids = Array.from(new Set(communes.map(row => row.id)))
  if (ids.length === 1) return ids[0]
  return ids.length === 0 ? null : 'ambiguous'
}

async function loadLocations(admin: SupabaseClient) {
  const { data, error } = await admin
    .from('locations')
    .select('id, parent_id, level, name, address, type, brand_id, is_private, is_active')
    .eq('is_active', true)

  if (error) throw new PhysicalLocationError(error.message, 500)
  return (data ?? []) as LocationNode[]
}

export async function resolvePhysicalLocation(
  admin: SupabaseClient,
  input: PhysicalLocationInput,
): Promise<ResolvePhysicalLocationResult> {
  if (input.locationId) {
    if (!isUuid(input.locationId)) {
      throw new PhysicalLocationError('Identificador de Location inválido.', 400)
    }

    const { data: location, error } = await admin
      .from('locations')
      .select('id, level, type, is_private, is_active')
      .eq('id', input.locationId)
      .maybeSingle()

    if (error) throw new PhysicalLocationError(error.message, 500)
    if (!location) throw new PhysicalLocationError('La Location seleccionada no existe.', 422)
    if (
      location.level !== 'place' ||
      !location.is_active ||
      location.is_private ||
      location.type === 'influencer_home'
    ) {
      throw new PhysicalLocationError('La Location seleccionada no es un lugar físico comercial válido.', 422)
    }

    return { locationId: location.id, matchType: 'existing' }
  }

  const rows = await loadLocations(admin)
  const byId = new Map(rows.map(row => [row.id, row]))
  const places = rows
    .filter(row => row.level === 'place' && !row.is_private && row.type !== 'influencer_home')
    .map(place => contextForNode(place, byId))

  const addressKey = normalizePhysicalText(input.address)
  const venueKey = normalizePhysicalText(input.venueName)

  if (!addressKey && !venueKey) {
    return { locationId: null, matchType: 'insufficient_data' }
  }

  if (addressKey) {
    const addressCandidates = places.filter(place => normalizePhysicalText(place.address) === addressKey)
    if (addressCandidates.length > 0) {
      const compatibleCandidates = addressCandidates.filter(place => compatible(place, input))
      if (compatibleCandidates.length === 1) {
        return { locationId: compatibleCandidates[0].id, matchType: 'existing' }
      }
      return { locationId: null, matchType: 'ambiguous' }
    }
  }

  if (!addressKey && venueKey) {
    const venueCandidates = places.filter(place => normalizePhysicalText(place.name) === venueKey)
    const compatibleCandidates = venueCandidates.filter(place => compatible(place, input))
    if (compatibleCandidates.length === 1) {
      return { locationId: compatibleCandidates[0].id, matchType: 'existing' }
    }
    if (venueCandidates.length > 0) {
      return { locationId: null, matchType: 'ambiguous' }
    }
  }

  if (input.createIfMissing === false || !enoughToCreate(input)) {
    return { locationId: null, matchType: 'insufficient_data' }
  }

  const communeId = findUniqueCommuneId(rows, input)
  if (communeId === 'ambiguous') {
    return { locationId: null, matchType: 'ambiguous' }
  }
  if (!communeId) {
    return { locationId: null, matchType: 'insufficient_data' }
  }

  const name = input.venueName?.trim() || input.address!.trim()
  const { data: created, error: createError } = await admin
    .from('locations')
    .insert({
      organization_id: input.organizationId,
      parent_id: communeId,
      level: 'place',
      type: 'event',
      name,
      address: input.address!.trim(),
      is_private: false,
      is_active: true,
    })
    .select('id')
    .single()

  if (!createError && created) {
    return { locationId: created.id, matchType: 'new' }
  }

  // Concurrent creation: re-check before surfacing the error so two requests
  // cannot silently create duplicate master locations.
  const retryRows = await loadLocations(admin)
  const retryPlaces = retryRows
    .filter(row => row.level === 'place' && !row.is_private && row.type !== 'influencer_home')
    .map(place => contextForNode(place, new Map(retryRows.map(row => [row.id, row]))))
    .filter(place => normalizePhysicalText(place.address) === addressKey)
    .filter(place => compatible(place, input))

  if (retryPlaces.length === 1) {
    return { locationId: retryPlaces[0].id, matchType: 'existing' }
  }
  if (retryPlaces.length > 1 || createError?.code === '23505') {
    return { locationId: null, matchType: 'ambiguous' }
  }
  throw new PhysicalLocationError(createError?.message ?? 'No se pudo crear la Location.', 422)
}
