import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/supabase/fetchAllRows'
import { loadLocationRows, type LocationNode } from '@/lib/influencer-location'
import {
  hasCriteria, loadPerformanceMap, matchesCriteria, sanitizeCriteria,
  type AudienceCriteria, type CriteriaSubject,
} from '@/lib/influencer-performance'

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

/** Criterios de segmentación (seguidores, engagement, rating, desempeño) por campaña. Viven en `campaigns.metadata.audience_criteria`. */
export async function loadAudienceCriteria(admin: Admin, campaignIds: string[]): Promise<Map<string, AudienceCriteria>> {
  const result = new Map<string, AudienceCriteria>()
  for (let i = 0; i < campaignIds.length; i += 100) {
    const { data, error } = await admin.from('campaigns').select('id, metadata').in('id', campaignIds.slice(i, i + 100))
    // Falla cerrado, igual que las zonas.
    if (error) throw error
    for (const row of data ?? []) {
      const criteria = sanitizeCriteria((row.metadata as Record<string, unknown> | null)?.audience_criteria)
      if (hasCriteria(criteria)) result.set(row.id as string, criteria)
    }
  }
  return result
}

const PERFORMANCE_KEYS: (keyof AudienceCriteria)[] = ['campaigns_min', 'compliance_min', 'no_shows_max', 'late_max']

/** Datos reales de cada influencer para evaluar criterios; lo que no existe queda en null (nunca se inventa). */
export async function loadCriteriaSubjects(admin: Admin, influencerIds: string[], withPerformance: boolean): Promise<Map<string, CriteriaSubject>> {
  const ids = Array.from(new Set(influencerIds.filter(Boolean)))
  const subjects = new Map<string, CriteriaSubject>()
  const perf = withPerformance ? await loadPerformanceMap(admin, ids) : new Map()
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100)
    const [infs, socials] = await Promise.all([
      fetchAllRows<{ id: string; rating: number | null }>((from, to) => admin.from('influencers').select('id, rating').in('id', batch).order('id').range(from, to)),
      fetchAllRows<{ influencer_id: string; followers: number | null; engagement_rate: number | null; last_synced_at: string | null }>((from, to) => admin
        .from('influencer_social_profiles').select('influencer_id, followers, engagement_rate, last_synced_at')
        .in('influencer_id', batch).eq('platform', 'instagram').order('influencer_id').range(from, to)),
    ])
    if (infs.error) throw infs.error
    if (socials.error) throw socials.error
    const ig = new Map(socials.data.map(r => [r.influencer_id, r]))
    for (const inf of infs.data) {
      const sp = ig.get(inf.id)
      // Un 0 sin sincronizar no es un dato real: se trata como desconocido.
      const known = (v: number | null | undefined) => (v == null || (Number(v) === 0 && !sp?.last_synced_at) ? null : Number(v))
      subjects.set(inf.id, {
        followers: known(sp?.followers),
        engagement: known(sp?.engagement_rate),
        rating: inf.rating == null || Number(inf.rating) === 0 ? null : Number(inf.rating),
        performance: perf.get(inf.id)?.summary ?? null,
      })
    }
  }
  return subjects
}

/**
 * Lectura completa: catálogo + zonas + criterios. `allows(campaña, ubicación, influencer)` combina ambos filtros.
 * Pasar `influencerIds` cuando se evalúen personas concretas; una campaña con criterios y una influencer sin datos
 * cargados NO coincide (falla cerrado).
 */
export async function audienceMatcherFor(admin: Admin, campaignIds: string[], influencerIds: string[] = []) {
  const [targets, nodes, criteria] = await Promise.all([
    loadAudienceTargets(admin, campaignIds), loadLocationRows(admin), loadAudienceCriteria(admin, campaignIds),
  ])
  const active = Array.from(criteria.values())
  const subjects = active.length && influencerIds.length
    ? await loadCriteriaSubjects(admin, influencerIds, active.some(c => PERFORMANCE_KEYS.some(k => c[k] != null)))
    : new Map<string, CriteriaSubject>()
  return {
    targets,
    nodes,
    criteria,
    allows: (campaignId: string, influencerLocationId: string | null | undefined, influencerId?: string | null) => {
      if (!matchesAudience(targets.get(campaignId), locationLineage(influencerLocationId, nodes))) return false
      const c = criteria.get(campaignId)
      if (!c) return true
      const subject = influencerId ? subjects.get(influencerId) : undefined
      return subject ? matchesCriteria(c, subject) : false
    },
  }
}
