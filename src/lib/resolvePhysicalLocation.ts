import type { SupabaseClient } from '@supabase/supabase-js'
import { isUuid } from '@/lib/locations'

export type PhysicalLocationDetails = {
  country?: string
  region?: string
  commune?: string
  city?: string
  venueName?: string
  address?: string
}

export type ResolvePhysicalLocationInput = {
  locationId?: string | null
  location?: string | null
  locationDetails?: PhysicalLocationDetails | null
  isVirtual?: boolean | null
}

export type ResolvePhysicalLocationResult = {
  locationId: string | null
  locationDisplay: string | null
  status: 'resolved' | 'pending' | 'virtual'
}

export class PhysicalLocationError extends Error {
  status: number
  constructor(message: string, status = 422) {
    super(message)
    this.name = 'PhysicalLocationError'
    this.status = status
  }
}

function legacyDisplay(input: ResolvePhysicalLocationInput) {
  if (input.location?.trim()) return input.location.trim()
  const details = input.locationDetails
  if (!details) return null
  return [
    details.venueName,
    details.address,
    [details.commune, details.region, details.country].filter(Boolean).join(', '),
  ].filter(Boolean).join(' · ') || null
}

export async function resolvePhysicalLocation(
  admin: SupabaseClient,
  input: ResolvePhysicalLocationInput,
): Promise<ResolvePhysicalLocationResult> {
  if (input.isVirtual) {
    return { locationId: null, locationDisplay: null, status: 'virtual' }
  }

  if (input.locationId != null) {
    if (!isUuid(input.locationId)) {
      throw new PhysicalLocationError('Identificador de lugar inválido.', 400)
    }

    const { data: place, error } = await admin
      .from('locations')
      .select('id, level, name, address')
      .eq('id', input.locationId)
      .maybeSingle()

    if (error) throw new PhysicalLocationError(error.message, 500)
    if (!place) throw new PhysicalLocationError('El lugar seleccionado no existe.', 422)
    if (place.level !== 'place') {
      throw new PhysicalLocationError('La ubicación seleccionada debe ser un lugar físico (place), no una región, ciudad o comuna.', 422)
    }

    const { data: breadcrumb, error: breadcrumbError } = await admin.rpc('location_breadcrumb', { p_id: place.id })
    if (breadcrumbError) throw new PhysicalLocationError(breadcrumbError.message, 500)

    const items = Array.isArray(breadcrumb) ? breadcrumb : []
    const geography = items
      .filter((item: { level?: string }) => item.level !== 'place')
      .map((item: { name?: string }) => item.name)
      .filter(Boolean)
      .join(' · ')

    return {
      locationId: place.id,
      locationDisplay: [place.name, geography, place.address].filter(Boolean).join(' — '),
      status: 'resolved',
    }
  }

  return {
    locationId: null,
    locationDisplay: legacyDisplay(input),
    status: 'pending',
  }
}
