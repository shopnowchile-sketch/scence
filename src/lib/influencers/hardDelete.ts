import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Tablas hijas que referencian influencer_id (columna por defecto) o la columna
 * indicada en `column`. Se borran antes del influencer para evitar violaciones
 * de FK. Si una tabla no existe o no tiene la columna, el error se ignora
 * (cleanup best-effort).
 *
 * Auditado 2026-07-11 contra information_schema (FKs reales hacia influencers.id)
 * tras un merge que fallaba: la lista original no cubría contracts,
 * influencer_payment_methods, affiliate_links (estaba mal escrita como
 * 'affiliates'), booking_influencers, barters, brand_influencers,
 * campaign_influencer_notifications y locations (columna owner_influencer_id).
 * Si se agregan tablas nuevas con FK a influencers.id, sumarlas aquí también.
 */
const CHILD_TABLES: ReadonlyArray<{ table: string; column: string }> = [
  { table: 'influencer_social_profiles', column: 'influencer_id' },
  { table: 'influencer_rate_cards', column: 'influencer_id' },
  { table: 'campaign_influencers', column: 'influencer_id' },
  { table: 'campaign_deliverables', column: 'influencer_id' },
  { table: 'payroll_items', column: 'influencer_id' },
  { table: 'bookings', column: 'influencer_id' },
  { table: 'booking_influencers', column: 'influencer_id' },
  { table: 'affiliate_links', column: 'influencer_id' },
  { table: 'events', column: 'influencer_id' },
  { table: 'contracts', column: 'influencer_id' },
  { table: 'influencer_payment_methods', column: 'influencer_id' },
  { table: 'barters', column: 'influencer_id' },
  { table: 'brand_influencers', column: 'influencer_id' },
  { table: 'campaign_influencer_notifications', column: 'influencer_id' },
  { table: 'locations', column: 'owner_influencer_id' },
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
  for (const { table, column } of CHILD_TABLES) {
    const { error } = await admin.from(table).delete().in(column, ids)
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
