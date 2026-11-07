import { buildInfluencerSubscriptionRow, getInfluencerPayPalToken, influencerPayPalBaseUrl, parseInfluencerReference } from './influencer-paypal'
import type { PayPalSubscriptionSnapshot } from './influencer-paypal'

type SupabaseAdmin = ReturnType<typeof import('./supabase/server').createAdminClient>

type PayPalDetails = PayPalSubscriptionSnapshot & { custom_id?: string; links?: Array<{ rel?: string; href?: string }> }
export type PayPalSubscriptionLookup = (paypalSubscriptionId: string) => Promise<{ ok: boolean; status: number; body: PayPalDetails | null }>

export type RecoveryInfluencer = { id: string; organization_id: string; user_id?: string | null }

/**
 * Resultado de revisar los intentos Pro pendientes de una influencer:
 * - none: no hay intentos pendientes.
 * - active: PayPal ya la tenía ACTIVE; SCENCE se sincronizó (Pro activado).
 * - processing: aprobó en PayPal y PayPal aún está activando; NO crear otra suscripción.
 * - pending: hay una suscripción reciente sin aprobar; se reutiliza su enlace.
 * - unavailable: no se pudo verificar (PayPal o base); se falla cerrado, sin crear otra.
 */
export type ProRecoveryResult =
  | { state: 'none' }
  | { state: 'active'; paypalSubscriptionId: string; duplicateActive: number }
  | { state: 'processing'; paypalSubscriptionId: string }
  | { state: 'pending'; paypalSubscriptionId: string; approveUrl: string }
  | { state: 'unavailable' }

const MAX_ATTEMPTS_CHECKED = 8
const PENDING_REUSE_WINDOW_MS = 24 * 60 * 60_000

export function paypalLookupFor(accessToken: string): PayPalSubscriptionLookup {
  return async id => {
    const response = await fetch(`${influencerPayPalBaseUrl()}/v1/billing/subscriptions/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' })
    return { ok: response.ok, status: response.status, body: await response.json().catch(() => null) }
  }
}

/**
 * Revisa en PayPal (solo lectura) los intentos Pro "incomplete" de la influencer y
 * sincroniza SCENCE con el estado real. Es lo que permite recuperar una inscripción
 * aunque la persona haya perdido la sesión o cambiado de navegador al volver de
 * PayPal, y lo que impide abrir una segunda suscripción (doble cobro) mientras
 * existe una anterior aprobada o en proceso.
 *
 * Nunca crea, cancela ni cobra nada en PayPal: solo hace GET. Solo toca filas
 * cuyo custom_id en PayPal pertenece a esta influencer.
 */
export async function reconcileInfluencerProSubscriptions(
  admin: SupabaseAdmin,
  influencer: RecoveryInfluencer,
  options: { accessToken?: string; lookup?: PayPalSubscriptionLookup; now?: Date } = {},
): Promise<ProRecoveryResult> {
  const now = options.now ?? new Date()
  const { data: plan, error: planError } = await admin.from('subscription_plans').select('id').eq('tier', 'pro').eq('is_active', true).maybeSingle()
  if (planError || !plan) {
    console.error('[influencer-pro-recovery] plan Pro no disponible', { error: planError?.message ?? 'sin plan activo' })
    return { state: 'unavailable' }
  }
  const { data: rows, error: rowsError } = await admin.from('subscriptions')
    .select('id, status, metadata, current_period_end, canceled_at, paypal_subscription_id, created_at')
    .eq('plan_id', plan.id)
    .eq('status', 'incomplete')
    .not('paypal_subscription_id', 'is', null)
    .filter('metadata->>influencer_id', 'eq', influencer.id)
    .order('created_at', { ascending: false })
    .limit(MAX_ATTEMPTS_CHECKED)
  if (rowsError) {
    console.error('[influencer-pro-recovery] no se pudieron leer los intentos pendientes', { error: rowsError.message })
    return { state: 'unavailable' }
  }
  if (!rows?.length) return { state: 'none' }

  let lookup = options.lookup
  if (!lookup) {
    const token = options.accessToken ?? await getInfluencerPayPalToken()
    if (!token) return { state: 'unavailable' }
    lookup = paypalLookupFor(token)
  }

  let active: { paypalSubscriptionId: string } | null = null
  let duplicateActive = 0
  let processing: { paypalSubscriptionId: string } | null = null
  let pending: { paypalSubscriptionId: string; approveUrl: string } | null = null

  for (const row of rows) {
    const paypalSubscriptionId = row.paypal_subscription_id as string
    const result = await lookup(paypalSubscriptionId)
    // 404: esa suscripción ya no existe en PayPal; se ignora. Cualquier otro
    // fallo impide asegurar que no haya un cobro en curso: se falla cerrado.
    if (!result.ok) {
      if (result.status === 404) continue
      console.error('[influencer-pro-recovery] PayPal no respondió', { paypalSubscriptionId, status: result.status })
      return { state: 'unavailable' }
    }
    const details = result.body
    const reference = parseInfluencerReference(details?.custom_id)
    if (!details || !reference || reference.influencerId !== influencer.id) continue

    const status = String(details.status ?? '').toUpperCase()
    if (status === 'ACTIVE') {
      const built = buildInfluencerSubscriptionRow({
        details, paypalSubscriptionId,
        existing: { id: row.id, metadata: row.metadata, current_period_end: row.current_period_end, canceled_at: row.canceled_at },
        influencer, planId: plan.id, campaignId: reference.campaignId, now,
      })
      const { error } = await admin.from('subscriptions').update(built).eq('id', row.id)
      if (error) {
        console.error('[influencer-pro-recovery] no se pudo sincronizar la suscripción activa', { paypalSubscriptionId, error: error.message })
        return { state: 'unavailable' }
      }
      if (active) duplicateActive += 1
      else active = { paypalSubscriptionId }
    } else if (status === 'APPROVED') {
      processing ??= { paypalSubscriptionId }
    } else if (status === 'APPROVAL_PENDING' && !pending) {
      const approveUrl = details.links?.find(link => link.rel === 'approve')?.href
      const createdAt = Date.parse(details.create_time ?? row.created_at ?? '')
      if (approveUrl && Number.isFinite(createdAt) && now.getTime() - createdAt < PENDING_REUSE_WINDOW_MS) {
        pending = { paypalSubscriptionId, approveUrl }
      }
    }
  }

  if (active) {
    if (duplicateActive > 0) {
      console.error('[influencer-pro-recovery] INFLUENCER_PRO_DUPLICATE_ACTIVE: más de una suscripción ACTIVE en PayPal para la misma influencer; revisar y cancelar la sobrante', { influencerId: influencer.id, duplicateActive: duplicateActive + 1 })
    }
    return { state: 'active', paypalSubscriptionId: active.paypalSubscriptionId, duplicateActive }
  }
  if (processing) return { state: 'processing', ...processing }
  if (pending) return { state: 'pending', ...pending }
  return { state: 'none' }
}

/**
 * Deja registrado el intento en SCENCE en el momento del checkout (estado
 * `incomplete`), sin esperar al webhook BILLING.SUBSCRIPTION.CREATED. Así la
 * recuperación no depende de que ese evento llegue, y queda guardado desde qué
 * contexto se inició (p. ej. navegador interno de Instagram). Es solo registro:
 * si falla, el checkout continúa.
 */
export async function recordProCheckout(
  admin: SupabaseAdmin,
  input: {
    influencer: RecoveryInfluencer
    paypalSubscriptionId: string
    campaignId: string | null
    context: { in_app_browser: boolean; return_campaign_id: string | null }
    now?: Date
  },
): Promise<{ ok: boolean }> {
  const now = input.now ?? new Date()
  const { data: plan, error: planError } = await admin.from('subscription_plans').select('id').eq('tier', 'pro').eq('is_active', true).maybeSingle()
  if (planError || !plan) {
    console.error('[influencer-pro-recovery] no se registró el checkout: plan Pro no disponible', { error: planError?.message ?? 'sin plan activo' })
    return { ok: false }
  }
  const row = buildInfluencerSubscriptionRow({
    details: { status: 'APPROVAL_PENDING', create_time: now.toISOString() },
    paypalSubscriptionId: input.paypalSubscriptionId, existing: null,
    influencer: input.influencer, planId: plan.id, campaignId: input.campaignId, now,
  })
  const checkout = { ...input.context, at: now.toISOString() }
  const { error } = await admin.from('subscriptions').insert({ ...row, metadata: { ...row.metadata, checkout } })
  if (!error) return { ok: true }
  if (error.code === '23505') {
    // El webhook CREATED llegó primero (o es el mismo intento reutilizado): se
    // agrega el contexto sin tocar nada más de la fila existente.
    const { data: existing } = await admin.from('subscriptions').select('id, metadata').eq('paypal_subscription_id', input.paypalSubscriptionId).maybeSingle()
    if (existing) {
      const metadata = { ...((existing.metadata ?? {}) as Record<string, unknown>) }
      if (!metadata.checkout) {
        await admin.from('subscriptions').update({ metadata: { ...metadata, checkout }, updated_at: now.toISOString() }).eq('id', existing.id)
      }
    }
    return { ok: true }
  }
  console.error('[influencer-pro-recovery] no se pudo registrar el checkout', { paypalSubscriptionId: input.paypalSubscriptionId, error: error.message })
  return { ok: false }
}
