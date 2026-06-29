import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Tablas hijas que referencian influencer_id. Se borran antes del influencer
 * para evitar violaciones de FK. Si una tabla no existe o no tiene la columna,
 * el error se ignora (cleanup best-effort).
 */
const CHILD_TABLES = [
  'influencer_social_profiles',
  'influencer_rate_cards',
  'campaign_influencers',
  'campaign_deliverables',
  'payroll_items',
  'bookings',
  'affiliates',
  'events',
  'influencer_tasks',
] as const

export interface HardDeleteResult {
  deleted: number
  requestedIds: string[]
  childErrors: Array<{ table: string; error: string }>
}

/**
 * Borra permanentemente influencers (y sus filas hijas) dentro de una organización.
 * Siempre scope por organization_id para no cruzar tenants.
 */
export async function hardDeleteInfluencers(
  admin: SupabaseClient,
  orgId: string,
  ids: string[],
): Promise<HardDeleteResult> {
  const childErrors: Array<{ table: string; error: string }> = []
  if (!ids.length) return { deleted: 0, requestedIds: [], childErrors }

  // 1. Borrar filas hijas (best-effort, no bloquea si la tabla no existe)
  for (const table of CHILD_TABLES) {
    const { error } = await admin.from(table).delete().in('influencer_id', ids)
    if (error) {
      const msg = error.message ?? ''
      // Ignorar tablas/columnas inexistentes
      if (/does not exist|relation|column/i.test(msg)) continue
      childErrors.push({ table, error: msg })
    }
  }

  // 2. Borrar los influencers (scope por org)
  const { data, error } = await admin
    .from('influencers')
    .delete()
    .eq('organization_id', orgId)
    .in('id', ids)
    .select('id')

  if (error) {
    throw new Error(`Error borrando influencers: ${error.message}`)
  }

  return {
    deleted: data?.length ?? 0,
    requestedIds: ids,
    childErrors,
  }
}
