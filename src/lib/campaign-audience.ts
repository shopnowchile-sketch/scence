import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/supabase/fetchAllRows'
import { loadLocationRows, type LocationNode } from '@/lib/influencer-location'

type Admin = SupabaseClient

export { LATAM_COUNTRY_NAMES, latamCountryIds, isLatamCountryName } from '@/lib/campaign-audience-latam'

/** Mapa campaña → ids de zonas objetivo. Una campaña sin entrada no tiene restricción. */
export async function loadAudienceTargets(admin: Admin, campaignIds: string[]): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>()
  if (!campaignIds.length) return result
  const { data, error } = await fetchAllRows<{ campaign_id: string; location_id: string }>((from, to) => admin
    .from('campaign_audience_locations')
    .select('campaign_id, location_id')
    .in('campaign_id', campaignIds)
    .order('campaign_id').order('location_id')
    .range(from, to))
  // Falla cerrado: sin poder leer la segmentación no se puede afirmar que la campaña sea abierta.
  if (error) throw error
  for (const row of data ?? []) {
    const list = result.get(row.campaign_id) ?? []
    list.push(row.location_id)
    result.set(row.campaign_id, list)
  }
  return result
}

/** Ids del nodo y todos sus ancestros (comuna → ciudad → región → país). */
export function locationLineage(locationId: string | null | undefined, nodes: Pick<LocationNode, 'id' | 'parent_id'>[]): Set<string> {
  const lineage = new Set<string>()
  if (!locationId) return lineage
  const byId = new Map(nodes.map(n => [n.id, n]))
  let current = byId.get(locationId)
  while (current && !lineage.has(current.id)) {
    lineage.add(current.id)
    current = current.parent_id ? byId.get(current.parent_id) : undefined
  }
  return lineage
}

/**
 * Regla única: sin zonas objetivo → visible para todas. Con zonas → solo si la
 * ubicación registrada de la influencer (o alguno de sus ancestros) es una de ellas.
 * Una influencer sin ubicación NO coincide con una campaña segmentada.
 */
export function matchesAudience(targetIds: string[] | undefined, influencerLineage: Set<string>): boolean {
  if (!targetIds || targetIds.length === 0) return true
  return targetIds.some(id => influencerLineage.has(id))
}

/** Lectura completa para una influencer: carga catálogo + segmentación y devuelve el predicado. */
export async function audienceMatcherFor(admin: Admin, campaignIds: string[]) {
  const [targets, nodes] = await Promise.all([loadAudienceTargets(admin, campaignIds), loadLocationRows(admin)])
  return {
    targets,
    nodes,
    allows: (campaignId: string, influencerLocationId: string | null | undefined) =>
      matchesAudience(targets.get(campaignId), locationLineage(influencerLocationId, nodes)),
  }
}
