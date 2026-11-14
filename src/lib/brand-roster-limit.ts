import type { SupabaseClient } from '@supabase/supabase-js'
import { PLAN_ERROR_CODES, getPlanLimits, resolveBrandPlanAccess, rosterLimitMessage } from '@/lib/plan-limits'

/**
 * Límite de influencers del plan de una marca — fuente única para INVITAR y para APROBAR postulaciones.
 *
 * Cupo ocupado = influencers únicas en las campañas VIGENTES de la marca (propias, creadas o compartidas;
 * ni `completed` ni `canceled`) que están aceptadas o tienen una invitación pendiente. Una invitación
 * pendiente reserva cupo porque la influencer la acepta sin pasar otra vez por la marca. Una postulación
 * pendiente no ocupa cupo: el límite se aplica al aprobarla. Quien ya ocupa cupo no vuelve a consumirlo.
 */

const FINISHED_CAMPAIGN_STATUSES = ['completed', 'canceled']

export type RosterRow = { influencer_id: string; application_status: string | null; origin: string | null }

/** Regla pura: ¿la fila ocupa cupo del plan? */
export function occupiesRosterSlot(row: Pick<RosterRow, 'application_status' | 'origin'>): boolean {
  return row.application_status === 'accepted' || (row.application_status === 'pending' && row.origin === 'invitation')
}

/** Regla pura: ¿se puede sumar a esta influencer sin pasar el tope? */
export function rosterHasRoom(rows: RosterRow[], influencerId: string, max: number): boolean {
  const occupied = new Set(rows.filter(occupiesRosterSlot).map(row => row.influencer_id))
  return occupied.has(influencerId) || occupied.size < max
}

export type RosterLimitResult =
  | { ok: true }
  | { ok: false; status: number; error: string; code?: string; plan?: string }

/**
 * `contractedPlanOnly`: aplica el tope solo si el plan viene de una suscripción pagada (una contratación).
 * Se usa al APROBAR postulaciones: las marcas que ya operaban sin plan contratado ni tope al aprobar
 * (decisión 2026-11-14) conservan sus campañas y postulaciones actuales sin bloqueo.
 */
export async function checkBrandRosterLimit(
  admin: SupabaseClient, brandId: string, influencerId: string, options: { contractedPlanOnly?: boolean } = {},
): Promise<RosterLimitResult> {
  const access = await resolveBrandPlanAccess(admin, brandId)
  if (options.contractedPlanOnly && access.source !== 'subscription') return { ok: true }
  const plan = access.plan
  const max = getPlanLimits(plan).max_roster_influencers

  const [own, shared] = await Promise.all([
    admin.from('campaigns').select('id, status').or(`brand_id.eq.${brandId},created_by_brand_id.eq.${brandId}`),
    admin.from('campaign_brands').select('campaign_id, campaign:campaigns(status)').eq('brand_id', brandId),
  ])
  if (own.error) return { ok: false, status: 500, error: own.error.message }
  if (shared.error) return { ok: false, status: 500, error: shared.error.message }

  const isLive = (status: unknown) => !FINISHED_CAMPAIGN_STATUSES.includes(String(status ?? ''))
  const campaignIds = Array.from(new Set([
    ...(own.data ?? []).filter(c => isLive(c.status)).map(c => c.id as string),
    ...((shared.data ?? []) as unknown as Array<{ campaign_id: string; campaign: { status?: string } | { status?: string }[] | null }>)
      .filter(row => isLive(Array.isArray(row.campaign) ? row.campaign[0]?.status : row.campaign?.status))
      .map(row => row.campaign_id),
  ]))
  if (campaignIds.length === 0) return { ok: true }

  const { data: rows, error } = await admin
    .from('campaign_influencers')
    .select('influencer_id, application_status, origin')
    .in('campaign_id', campaignIds)
    .in('application_status', ['accepted', 'pending'])
  if (error) return { ok: false, status: 500, error: error.message }

  if (rosterHasRoom((rows ?? []) as RosterRow[], influencerId, max)) return { ok: true }
  return { ok: false, status: 403, error: rosterLimitMessage(plan), code: PLAN_ERROR_CODES.ROSTER_LIMIT, plan }
}
