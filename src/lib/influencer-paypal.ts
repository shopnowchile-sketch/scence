export const influencerPayPalBaseUrl = () => process.env.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'

export async function getInfluencerPayPalToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID, clientSecret = process.env.PAYPAL_CLIENT_SECRET
  if (!clientId || !clientSecret) return null
  const authorization = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const response = await fetch(`${influencerPayPalBaseUrl()}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${authorization}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials', cache: 'no-store' })
  const result = await response.json().catch(() => null)
  return response.ok ? result?.access_token as string | undefined : null
}

export function parseInfluencerReference(customId: unknown) {
  const [kind, influencerId, campaignId] = String(customId ?? '').split(':')
  return kind === 'influencer' && influencerId ? { influencerId, campaignId: campaignId || null } : null
}


type PayPalSubscriptionDetails = {
  status?: string
  billing_info?: { next_billing_time?: string; last_payment?: { time?: string } }
}

function addOneMonth(iso: string): string {
  const date = new Date(iso)
  date.setUTCMonth(date.getUTCMonth() + 1)
  return date.toISOString()
}

/**
 * Fecha hasta la que el período mensual ya está pagado, según PayPal.
 * Mientras la suscripción está ACTIVE es `next_billing_time` (el próximo cobro).
 * Tras cancelar/expirar PayPal ya no informa `next_billing_time`: se usa el
 * último pago + 1 mes. Si no hay ninguno de los dos, devuelve null.
 */
export function payPalPaidThrough(details: PayPalSubscriptionDetails | null | undefined): string | null {
  const next = details?.billing_info?.next_billing_time
  if (next && !Number.isNaN(Date.parse(next))) return new Date(next).toISOString()
  const lastPayment = details?.billing_info?.last_payment?.time
  if (lastPayment && !Number.isNaN(Date.parse(lastPayment))) return addOneMonth(lastPayment)
  return null
}

/**
 * Cancela la suscripción Pro en PayPal SIN cobro adicional y devuelve la fecha
 * hasta la que el mes ya pagado sigue vigente.
 *
 * Se usa el endpoint documentado POST /cancel: detiene todo cobro futuro de forma
 * inmediata y determinista. El período ya pagado NO se pierde: SCENCE conserva Pro
 * hasta `paidThrough` porque `grantsPro()` (lib/influencer-pro.ts) ya acepta
 * `status = 'canceled'` con `current_period_end` futuro. Ver
 * audits/2026-09-23/04_PAYPAL_CANCEL_AUDIT.md (Opción A).
 *
 * Reemplaza a la versión anterior que modificaba `total_cycles`: leía
 * `cycle_executions` en la raíz (PayPal lo devuelve en `billing_info`) y su
 * fórmula `cycles_completed + 1` habría generado un cobro extra.
 */
export async function cancelInfluencerPayPalAtPeriodEnd(paypalSubscriptionId: string): Promise<{ paidThrough: string; alreadyCanceled: boolean }> {
  const accessToken = await getInfluencerPayPalToken()
  if (!accessToken) throw new Error('PayPal no está configurado.')
  const subscriptionUrl = `${influencerPayPalBaseUrl()}/v1/billing/subscriptions/${encodeURIComponent(paypalSubscriptionId)}`

  const detailsResponse = await fetch(subscriptionUrl, { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' })
  const details = await detailsResponse.json().catch(() => null) as (PayPalSubscriptionDetails & { message?: string }) | null
  if (!detailsResponse.ok) throw new Error(details?.message ?? 'PayPal no pudo consultar la suscripción.')

  // Se calcula ANTES de cancelar: después PayPal deja de informar next_billing_time.
  const paidThrough = payPalPaidThrough(details)
  if (!paidThrough) throw new Error('PayPal no informó la fecha de término del período pagado. No se canceló la suscripción.')

  const status = String(details?.status ?? '').toUpperCase()
  if (status === 'CANCELLED' || status === 'EXPIRED') return { paidThrough, alreadyCanceled: true }

  const cancelResponse = await fetch(`${subscriptionUrl}/cancel`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'Cancelación solicitada en SCENCE: se mantiene el período mensual ya pagado y no se renueva.' }),
    cache: 'no-store',
  })
  if (cancelResponse.status === 204 || cancelResponse.ok) return { paidThrough, alreadyCanceled: false }

  const detail = await cancelResponse.json().catch(() => null) as { name?: string; message?: string; details?: Array<{ issue?: string }> } | null
  // Doble clic / carrera: PayPal responde 422 si ya estaba cancelada. Es idempotente.
  if (cancelResponse.status === 422 && detail?.details?.some(item => item.issue === 'SUBSCRIPTION_STATUS_INVALID')) {
    return { paidThrough, alreadyCanceled: true }
  }
  throw new Error(detail?.message ?? 'PayPal no pudo cancelar la suscripción.')
}

type SupabaseAdmin = ReturnType<typeof import('@/lib/supabase/server').createAdminClient>

/**
 * Persiste en SCENCE una cancelación Pro ya confirmada por PayPal. Nunca
 * retrocede `current_period_end`: conserva la fecha mayor entre la guardada y
 * `paidThrough`. Devuelve el error de Supabase para que cada ruta lo revise.
 */
export async function persistInfluencerProCancellation(
  admin: SupabaseAdmin,
  subscription: { id: string; current_period_end?: string | null; metadata?: unknown },
  paidThrough: string,
  reason: 'influencer_requested' | 'influencer_deactivated' | 'influencer_inactivated_by_admin',
) {
  const now = new Date().toISOString()
  const storedEnd = subscription.current_period_end ? Date.parse(subscription.current_period_end) : NaN
  const periodEnd = Number.isFinite(storedEnd) && storedEnd > Date.parse(paidThrough) ? new Date(storedEnd).toISOString() : paidThrough
  const { error } = await admin.from('subscriptions').update({
    status: 'canceled',
    canceled_at: now,
    current_period_end: periodEnd,
    updated_at: now,
    metadata: {
      ...((subscription.metadata ?? {}) as Record<string, unknown>),
      cancel_at_period_end: true,
      paid_through: periodEnd,
      scheduled_cancel_at: periodEnd,
      scheduled_cancel_reason: reason,
      cancel_requested_at: now,
    },
  }).eq('id', subscription.id)
  return { error, periodEnd }
}

/** true si la suscripción ya tiene una cancelación programada/efectiva. */
export function isInfluencerProCancellationScheduled(subscription: { status?: string | null; metadata?: unknown } | null | undefined): boolean {
  if (!subscription) return false
  const metadata = (subscription.metadata ?? {}) as { cancel_at_period_end?: boolean }
  return subscription.status === 'canceled' || metadata.cancel_at_period_end === true
}

// ── Fuente única del estado Pro pagado ───────────────────────────────────────

/**
 * ¿Esta fila de `subscriptions` da Pro? Regla de negocio única:
 * active/trialing = Pro; canceled conserva Pro hasta current_period_end.
 * past_due / incomplete / canceled vencida = no Pro.
 * La usan getInfluencerProStatuses (lib/influencer-pro.ts) y /api/influencer/billing.
 */
export function influencerSubscriptionGrantsPro(
  subscription: { status?: string | null; current_period_end?: string | null },
  now: number = Date.now(),
): boolean {
  if (subscription.status === 'active' || subscription.status === 'trialing') return true
  return subscription.status === 'canceled'
    && Boolean(subscription.current_period_end)
    && new Date(subscription.current_period_end as string).getTime() > now
}

export const PAYPAL_SUBSCRIPTION_STATUS_MAP: Record<string, string> = {
  ACTIVE: 'active',
  APPROVAL_PENDING: 'incomplete',
  APPROVED: 'incomplete',
  SUSPENDED: 'past_due',
  CANCELLED: 'canceled',
  EXPIRED: 'canceled',
}

export type PayPalSubscriptionSnapshot = PayPalSubscriptionDetails & {
  start_time?: string
  create_time?: string
  subscriber?: { payer_id?: string }
}

export type StoredInfluencerSubscription = {
  id: string
  metadata: unknown
  current_period_end: string | null
  canceled_at: string | null
}

/**
 * Construye la fila de `subscriptions` de una influencer a partir del estado
 * ACTUAL de la suscripción en PayPal (GET /v1/billing/subscriptions/:id), nunca
 * del payload del evento. Por eso un webhook duplicado, atrasado o fuera de
 * orden produce siempre la misma fila: la de PayPal hoy.
 *
 * Garantías:
 * - `current_period_end` nunca retrocede: se conserva la mayor entre la guardada
 *   y la que informa PayPal (una renovación la adelanta; nada la atrasa).
 * - La metadata existente se conserva (vínculo, cancelación programada,
 *   relinked_from…); solo se agregan las marcas de cancelación cuando aplica.
 * - `metadata.influencer_id` lo decide quien llama (la ficha resuelta).
 */
export function buildInfluencerSubscriptionRow(input: {
  details: PayPalSubscriptionSnapshot
  paypalSubscriptionId: string
  existing: StoredInfluencerSubscription | null
  /** Ficha resuelta. `user_id` = identidad estable (auth): sobrevive a que la ficha se borre y se recree. */
  influencer: { id: string; organization_id: string; user_id?: string | null }
  planId: string
  campaignId: string | null
  now?: Date
}) {
  const now = input.now ?? new Date()
  const status = PAYPAL_SUBSCRIPTION_STATUS_MAP[String(input.details.status ?? '').toUpperCase()] ?? 'incomplete'
  const start = input.details.start_time ?? input.details.create_time ?? now.toISOString()
  const reportedEnd = payPalPaidThrough(input.details) ?? start
  const storedEnd = input.existing?.current_period_end ? Date.parse(input.existing.current_period_end) : NaN
  const end = Number.isFinite(storedEnd) && storedEnd > Date.parse(reportedEnd)
    ? new Date(storedEnd).toISOString()
    : new Date(reportedEnd).toISOString()

  const existingMetadata = (input.existing?.metadata ?? null) as Record<string, unknown> | null
  const identity: Record<string, unknown> = { account_type: 'influencer', influencer_id: input.influencer.id }
  if (input.influencer.user_id) identity.user_id = input.influencer.user_id
  const previousInfluencerId = typeof existingMetadata?.influencer_id === 'string' ? existingMetadata.influencer_id : null
  // Re-vínculo (la ficha anterior ya no existe): queda trazado.
  if (previousInfluencerId && previousInfluencerId !== input.influencer.id) {
    identity.relinked_from = previousInfluencerId
    identity.relinked_at = now.toISOString()
  }
  const baseMetadata: Record<string, unknown> = existingMetadata
    ? { ...existingMetadata, ...identity }
    : { ...identity, campaign_commitments: input.campaignId ? [input.campaignId] : [] }
  // Cancelación hecha directo en PayPal: se marca igual que la hecha en SCENCE.
  const metadata = status === 'canceled'
    ? { ...baseMetadata, cancel_at_period_end: true, paid_through: end }
    : baseMetadata

  return {
    organization_id: input.influencer.organization_id,
    plan_id: input.planId,
    status,
    current_period_start: start,
    current_period_end: end,
    paypal_subscription_id: input.paypalSubscriptionId,
    paypal_payer_id: input.details.subscriber?.payer_id ?? null,
    metadata,
    canceled_at: status === 'canceled' ? (input.existing?.canceled_at ?? now.toISOString()) : null,
    updated_at: now.toISOString(),
  }
}

/**
 * Reconciliación segura de suscripciones Pro huérfanas (identidad estable = usuario).
 * Recibe las suscripciones del MISMO usuario (metadata.user_id) y devuelve las que
 * deben re-vincularse a la ficha actual: solo las que apuntan a una ficha que ya
 * no existe. Nunca mueve una suscripción cuya ficha sigue existiendo.
 */
export function selectOrphanSubscriptionsToRelink(
  subscriptions: Array<{ id: string; metadata: unknown }>,
  existingInfluencerIds: ReadonlySet<string>,
  targetInfluencerId: string,
): string[] {
  return subscriptions
    .filter(row => {
      const linked = (row.metadata as { influencer_id?: unknown } | null)?.influencer_id
      if (typeof linked !== 'string' || !linked) return false
      if (linked === targetInfluencerId) return false
      return !existingInfluencerIds.has(linked)
    })
    .map(row => row.id)
}
