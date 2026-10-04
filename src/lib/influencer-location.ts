import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/supabase/fetchAllRows'

export type OfficialInfluencerLocation = {
  country: string | null
  region: string | null
  city: string | null
  commune: string | null
  label: string | null
}

/**
 * Resolves influencer.location_id through the canonical locations hierarchy.
 * This is the only place report/ranking code should derive geography.
 */
export async function getOfficialInfluencerLocations(
  admin: SupabaseClient,
  influencerRows: Array<{ id: string; location_id?: string | null }>
): Promise<Map<string, OfficialInfluencerLocation>> {
  const locationIds = Array.from(new Set(
    influencerRows.map(row => row.location_id).filter((id): id is string => Boolean(id))
  ))
  const result = new Map<string, OfficialInfluencerLocation>()
  if (locationIds.length === 0) return result

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

  const byId = new Map(
    (locations ?? []).map(row => [row.id as string, row as {
      id: string
      parent_id: string | null
      level: 'country' | 'region' | 'city' | 'commune'
      name: string
      is_active: boolean
    }])
  )

  for (const influencer of influencerRows) {
    if (!influencer.location_id) continue

    let current = byId.get(influencer.location_id)
    if (!current) continue

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
      if (!current.parent_id) break
      current = byId.get(current.parent_id)
    }

    result.set(influencer.id, {
      country,
      region,
      city,
      commune,
      label: commune ?? city ?? region ?? country ?? null,
    })
  }

  return result
}
