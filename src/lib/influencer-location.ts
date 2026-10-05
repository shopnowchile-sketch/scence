import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/supabase/fetchAllRows'

export type OfficialInfluencerLocation = {
  country: string | null
  region: string | null
  city: string | null
  commune: string | null
  label: string | null
}

export type LocationNode = {
  id: string
  parent_id: string | null
  level: 'country' | 'region' | 'city' | 'commune'
  name: string
  is_active: boolean
}

/**
 * Única lectura del catálogo locations (sin 'place'), ordenada y completa:
 * pagina hasta el final, sin tope silencioso. Incluye inactivas para que
 * Data Quality pueda distinguir ubicaciones inactivas de huérfanas.
 */
export async function loadLocationRows(admin: SupabaseClient): Promise<LocationNode[]> {
  const { data, error } = await fetchAllRows<LocationNode>(
    (from, to) => admin
      .from('locations')
      .select('id, parent_id, level, name, is_active')
      .neq('level', 'place')
      .order('id', { ascending: true })
      .range(from, to),
    { maxRows: Number.POSITIVE_INFINITY }
  )
  if (error) throw error
  return data
}

/** Mapa id → nombres derivados, solo con ubicaciones activas (comportamiento oficial). */
export function buildOfficialLocationDisplayMap(
  allRows: LocationNode[]
): Map<string, OfficialInfluencerLocation> {
  const rows = allRows.filter(row => row.is_active)
  const byId = new Map(rows.map(row => [row.id, row]))
  const result = new Map<string, OfficialInfluencerLocation>()

  for (const location of rows) {
    let current: LocationNode | undefined = location
    let country: string | null = null
    let region: string | null = null
    let city: string | null = null
    let commune: string | null = null
    const visited = new Set<string>()

    while (current && !visited.has(current.id)) {
      visited.add(current.id)
      if (current.level === 'country') country = current.name
      if (current.level === 'region') region = current.name
      if (current.level === 'city') city = current.name
      if (current.level === 'commune') commune = current.name
      current = current.parent_id ? byId.get(current.parent_id) : undefined
    }

    result.set(location.id, {
      country,
      region,
      city,
      commune,
      label: commune ?? city ?? region ?? country ?? null,
    })
  }

  return result
}

export async function getOfficialLocationDisplayMap(
  admin: SupabaseClient
): Promise<Map<string, OfficialInfluencerLocation>> {
  return buildOfficialLocationDisplayMap(await loadLocationRows(admin))
}

/**
 * Resolves influencer.location_id through the canonical locations hierarchy.
 * This is the only place report/ranking code should derive geography.
 */
export async function getOfficialInfluencerLocations(
  admin: SupabaseClient,
  influencerRows: Array<{ id: string; location_id?: string | null }>
): Promise<Map<string, OfficialInfluencerLocation>> {
  const locationDisplayById = await getOfficialLocationDisplayMap(admin)
  const result = new Map<string, OfficialInfluencerLocation>()

  for (const influencer of influencerRows) {
    if (!influencer.location_id) continue
    const location = locationDisplayById.get(influencer.location_id)
    if (location) result.set(influencer.id, location)
  }

  return result
}

/**
 * Reemplaza country/region/city/commune de una fila de influencer por los
 * valores derivados de location_id → locations. Sin location_id (o con un
 * location_id que no resuelve) quedan en null: nunca se usa geografía legacy.
 */
export function withOfficialInfluencerLocation<T extends { location_id?: string | null }>(
  influencer: T,
  locationDisplayById: Map<string, OfficialInfluencerLocation>
): T & { country: string | null; region: string | null; city: string | null; commune: string | null } {
  const location = influencer.location_id ? locationDisplayById.get(influencer.location_id) : undefined
  return {
    ...influencer,
    country: location?.country ?? null,
    region: location?.region ?? null,
    city: location?.city ?? null,
    commune: location?.commune ?? null,
  }
}
