import type { SupabaseClient } from '@supabase/supabase-js'

// Resuelve, en el SERVIDOR, las condiciones comerciales de un contrato a partir
// de una colaboración confirmada. El cliente solo indica `collaboration_id`:
// marca, nombre del plan y monto NUNCA se toman del body.

export type CollaborationContractTerms = {
  collaborationId: string
  planId: string
  partnerBrandId: string
  packageName: string
  packageAmount: number
}

export type CollaborationContractResult =
  | { ok: true; terms: CollaborationContractTerms }
  | { ok: false; status: number; error: string }

const fail = (status: number, error: string): CollaborationContractResult => ({ ok: false, status, error })

export async function resolveCollaborationContractTerms(
  admin: SupabaseClient,
  campaignId: string,
  collaborationId: string,
): Promise<CollaborationContractResult> {
  const { data: collab, error } = await admin
    .from('campaign_brand_collaborations')
    .select('id, campaign_id, lead_id, brand_id, status, plan_id')
    .eq('id', collaborationId)
    .eq('campaign_id', campaignId)
    .maybeSingle()
  if (error) return fail(500, error.message)
  if (!collab) return fail(404, 'Colaboración no encontrada en esta campaña')

  if (collab.status !== 'confirmed') {
    return fail(422, 'Solo se puede generar el contrato de una colaboración en estado "Confirmada"')
  }

  let leadBrandId: string | null = null
  if (!collab.brand_id && collab.lead_id) {
    const { data: lead, error: leadError } = await admin.from('crm_leads').select('converted_brand_id').eq('id', collab.lead_id).maybeSingle()
    if (leadError) return fail(500, leadError.message)
    leadBrandId = lead?.converted_brand_id ?? null
  }
  // Misma regla que resolveContractBrandId (campaign-collaborations-shared): la marca
  // asociada, o la que resultó de convertir el lead. Inline para que el módulo
  // sea ejecutable por `node --test` sin el alias `@/`.
  const partnerBrandId = collab.brand_id ?? leadBrandId ?? null
  if (!partnerBrandId) {
    return fail(422, 'La colaboración no tiene una marca asociada. Convierte el lead a marca antes de generar el contrato')
  }

  if (!collab.plan_id) return fail(422, 'La colaboración no tiene un plan asignado')

  // El plan se vuelve a leer del servidor y debe ser de esta campaña.
  const { data: plan, error: planError } = await admin
    .from('campaign_collaboration_plans')
    .select('id, name, amount')
    .eq('id', collab.plan_id)
    .eq('campaign_id', campaignId)
    .maybeSingle()
  if (planError) return fail(500, planError.message)
  if (!plan) return fail(422, 'El plan de la colaboración no pertenece a esta campaña')

  const amount = plan.amount === null || plan.amount === undefined ? NaN : Number(plan.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    return fail(422, `El plan "${plan.name}" no tiene un monto definido. Defínelo en los planes de la campaña antes de generar el contrato`)
  }

  return {
    ok: true,
    terms: {
      collaborationId: collab.id,
      planId: plan.id,
      partnerBrandId,
      packageName: plan.name,
      packageAmount: amount,
    },
  }
}

/** Las dos cuotas deben sumar 100%. Devuelve el mensaje de error o null. */
export function validatePaymentSplit(payment: { first_percentage?: number; second_percentage?: number } | undefined): string | null {
  if (!payment) return null
  const first = Number(payment.first_percentage)
  const second = Number(payment.second_percentage)
  if (!Number.isFinite(first) || !Number.isFinite(second) || first <= 0 || second <= 0) return 'Los porcentajes de pago deben ser mayores a 0'
  if (Math.round((first + second) * 100) !== 10000) return 'Los porcentajes de pago deben sumar 100%'
  return null
}

/**
 * Un contrato por (campaña, marca), independiente de campaign_brand_id.
 * Los índices únicos de `contracts` no cubren el caso en que la marca tenía un
 * contrato sin campaign_brand y luego se agrega a campaign_brands: este chequeo
 * en el servidor lo cierra (la carrera residual no tiene restricción en la base).
 */
export async function findExistingBrandContract(admin: SupabaseClient, campaignId: string, brandId: string) {
  const { data, error } = await admin
    .from('contracts')
    .select('id, status, title')
    .eq('campaign_id', campaignId)
    .eq('brand_id', brandId)
    .eq('party_type', 'brand')
    .limit(1)
    .maybeSingle()
  return { existing: data ?? null, error }
}
