import type { SupabaseClient } from '@supabase/supabase-js'
import { getInfluencerProIds } from '@/lib/influencer-pro'

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
  { table: 'influencer_terms_acceptances', column: 'influencer_id' },
  { table: 'barters', column: 'influencer_id' },
  { table: 'brand_influencers', column: 'influencer_id' },
  { table: 'campaign_influencer_notifications', column: 'influencer_id' },
  { table: 'locations', column: 'owner_influencer_id' },
] as const

/**
 * Una ficha con valor comercial NO se borra físicamente: se desactiva
 * (is_active = false). Incidente 2026-10-04: un borrado masivo eliminó una
 * influencer con Pro pagado y con una postulación, y la cascada se llevó la
 * postulación y dejó la suscripción huérfana.
 *
 * - 'billing'  (siempre): Pro (pagado o manual), cualquier suscripción que no
 *   sea un checkout abandonado (incomplete) o cualquier pago registrado.
 * - 'history'  (por defecto): además, historial comercial — postulaciones,
 *   entregables, contratos, pagos a influencers, reservas, canjes, términos
 *   aceptados, comisiones.
 * El merge usa 'billing' porque es su propio flujo de consolidación.
 */
export type DeleteProtection = 'billing' | 'history'

const HISTORY_TABLES: ReadonlyArray<{ table: string; label: string }> = [
  { table: 'campaign_influencers', label: 'postulaciones/participaciones en campañas' },
  { table: 'campaign_deliverables', label: 'entregables' },
  { table: 'contracts', label: 'contratos' },
  { table: 'payroll_items', label: 'pagos a la influencer' },
  { table: 'bookings', label: 'reservas' },
  { table: 'booking_influencers', label: 'reservas' },
  { table: 'barters', label: 'canjes' },
  { table: 'influencer_terms_acceptances', label: 'términos aceptados' },
  { table: 'commission_settlements', label: 'comisiones' },
  { table: 'affiliate_conversions', label: 'conversiones de afiliado' },
  { table: 'influencer_documents', label: 'documentos' },
]

export class InfluencerNotDeletableError extends Error {
  /** Ids bloqueados (se mantiene el nombre por compatibilidad con las respuestas 409). */
  readonly proIds: string[]
  readonly reasons: Record<string, string[]>
  constructor(reasons: Record<string, string[]>) {
    const ids = Object.keys(reasons)
    const labels = Array.from(new Set(Object.values(reasons).flat()))
    super(`No se puede eliminar permanentemente: ${ids.length === 1 ? '1 influencer tiene' : `${ids.length} influencers tienen`} ${labels.join(', ')}. Desactívala en su lugar.`)
    this.name = 'InfluencerNotDeletableError'
    this.proIds = ids
    this.reasons = reasons
  }
}
/** Alias histórico: los llamadores existentes siguen funcionando. */
export const InfluencerHasProError = InfluencerNotDeletableError

/**
 * Lanza InfluencerNotDeletableError si algún id tiene valor comercial.
 * Falla cerrado: si no se puede verificar, lanza el error de base.
 */
export async function assertNoProInfluencers(admin: SupabaseClient, ids: string[], protection: DeleteProtection = 'history'): Promise<void> {
  const reasons: Record<string, string[]> = {}
  // Tandas: .in(...) va en la URL de PostgREST (mismo criterio que getInfluencerProStatuses).
  for (let offset = 0; offset < ids.length; offset += 200) {
    Object.assign(reasons, await collectDeleteBlockers(admin, ids.slice(offset, offset + 200), protection))
  }
  if (Object.keys(reasons).length > 0) throw new InfluencerNotDeletableError(reasons)
}

async function collectDeleteBlockers(admin: SupabaseClient, ids: string[], protection: DeleteProtection): Promise<Record<string, string[]>> {
  const reasons: Record<string, string[]> = {}
  const add = (id: string | null | undefined, label: string) => {
    if (!id || !ids.includes(id)) return
    reasons[id] = Array.from(new Set([...(reasons[id] ?? []), label]))
  }

  for (const id of Array.from(await getInfluencerProIds(admin, ids))) add(id, 'Plan Pro')

  const [subscriptions, payments] = await Promise.all([
    admin.from('subscriptions').select('metadata').in('metadata->>influencer_id', ids).neq('status', 'incomplete'),
    admin.from('subscription_payments').select('influencer_id').in('influencer_id', ids),
  ])
  if (subscriptions.error) throw subscriptions.error
  if (payments.error) throw payments.error
  for (const row of subscriptions.data ?? []) add((row.metadata as { influencer_id?: string } | null)?.influencer_id, 'historial de suscripción')
  for (const row of payments.data ?? []) add(row.influencer_id as string | null, 'pagos registrados')

  if (protection === 'history') {
    const results = await Promise.all(HISTORY_TABLES.map(({ table }) => admin.from(table).select('influencer_id').in('influencer_id', ids)))
    results.forEach((result, index) => {
      if (result.error) {
        // Tabla inexistente en este entorno: no aporta historial.
        if (/does not exist|relation|column/i.test(result.error.message ?? '')) return
        throw result.error
      }
      for (const row of result.data ?? []) add(row.influencer_id as string | null, HISTORY_TABLES[index].label)
    })
  }

  return reasons
}

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
  protection: DeleteProtection = 'history',
): Promise<HardDeleteResult> {
  const childErrors: Array<{ table: string; error: string }> = []
  if (!ids.length) return { deleted: 0, requestedIds: [], childErrors }

  // 0. Nunca borrar una ficha con valor comercial (falla cerrado si no se puede verificar).
  await assertNoProInfluencers(admin, ids, protection)

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
