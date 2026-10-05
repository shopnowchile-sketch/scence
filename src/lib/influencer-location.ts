import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/supabase/fetchAllRows'

export type OfficialInfluencerLocation = {
  country: string | null
  region: string | null
  city: string | null
  commune: string | null
  label: string | null
}

type LocationNode = {
  id: string
  parent_id: string | null
  level: 'country' | 'region' | 'city' | 'commune'
  name: string
  is_active: boolean
}

export async function getOfficialLocationDisplayMap(
  admin: SupabaseClient
): Promise<Map<string, OfficialInfluencerLocation>> {
  const { data: locations, error } = await fetchAllRows(
    (from, to) => admin
      .from('locations')
      .select('id, parent_id, level, name, is_active')
      .eq('is_active', true)
      .neq('level', 'place')
      .range(from, to),
    { maxRows: 5000 }
  )

  if (error) throw error

  const rows = (locations ?? []) as LocationNode[]
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

/**
 * Resolves influencer.location_id through the canonical locations hierarchy.
 * This is the only place report/ranking code should derive geography.
 */
export async function withOfficialInfluencerLocation<T extends { influencer?: ({ id: string; location_id?: string | null } & Record<string, unknown>) | null }>(
  admin: SupabaseClient,
  rows: T[],
): Promise<T[]> {
  const influencerRows = rows
    .map(row => row.influencer)
    .filter((influencer): influencer is NonNullable<T['influencer']> => Boolean(influencer))
    .map(influencer => ({ id: influencer.id, location_id: influencer.location_id }))

  const locations = await getOfficialInfluencerLocations(admin, influencerRows)

  return rows.map(row => {
    if (!row.influencer) return row
    const location = locations.get(row.influencer.id)
    return location
      ? { ...row, influencer: { ...row.influencer, ...location } }
      : row
  })
}

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
