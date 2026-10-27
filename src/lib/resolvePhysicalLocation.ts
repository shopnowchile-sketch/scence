import type { SupabaseClient } from '@supabase/supabase-js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Un `location_id` enviado por el cliente se valida contra `locations` (fuente única, §16.11) y se deriva el texto de visualización. */
export class PhysicalLocationError extends Error {
  status: number
  constructor(message: string, status = 422) {
    super(message)
    this.name = 'PhysicalLocationError'
    this.status = status
  }
}

export type ResolvedPhysicalLocation = { locationId: string | null; locationDisplay: string | null }

export async function resolvePhysicalLocation(
  admin: SupabaseClient,
  input: { locationId?: string | null; location?: string | null; isVirtual?: boolean | null },
): Promise<ResolvedPhysicalLocation> {
  if (input.isVirtual) return { locationId: null, locationDisplay: null }
  if (input.locationId == null || input.locationId === '') {
    return { locationId: null, locationDisplay: input.location?.trim() || null }
  }
  if (!UUID_RE.test(input.locationId)) throw new PhysicalLocationError('Identificador de lugar inválido.', 400)

  const { data: place, error } = await admin
    .from('locations')
    .select('id, level, name, address, type, is_private, is_active')
    .eq('id', input.locationId)
    .maybeSingle()
  if (error) throw new PhysicalLocationError(error.message, 500)
  if (!place || place.is_active === false) throw new PhysicalLocationError('El lugar seleccionado no existe.', 422)
  if (place.level !== 'place') throw new PhysicalLocationError('La ubicación debe ser un lugar físico, no una región o comuna.', 422)
  // Un domicilio de influencer jamás es sede de un evento o reserva.
  if (place.is_private || place.type === 'influencer_home') throw new PhysicalLocationError('El lugar seleccionado no está disponible.', 422)

  const { data: breadcrumb, error: breadcrumbError } = await admin.rpc('location_breadcrumb', { p_id: place.id })
  if (breadcrumbError) throw new PhysicalLocationError(breadcrumbError.message, 500)
  const geography = (Array.isArray(breadcrumb) ? breadcrumb : [])
    .filter((item: { level?: string }) => item.level !== 'place')
    .map((item: { name?: string }) => item.name)
    .filter(Boolean)
    .join(' · ')
  return {
    locationId: place.id,
    locationDisplay: [place.name, geography, place.address].filter(Boolean).join(' — '),
  }
}
