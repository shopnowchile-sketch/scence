import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { buildInfluencerSubscriptionRow, parseInfluencerReference, payPalPaidThrough, PAYPAL_SUBSCRIPTION_STATUS_MAP, type PayPalSubscriptionSnapshot } from '@/lib/influencer-paypal'
import { isInfluencerSubscription } from '@/lib/plan-limits'

const STATUS_MAP = PAYPAL_SUBSCRIPTION_STATUS_MAP
function baseUrl() { return process.env.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com' }
async function token() {
  const id = process.env.PAYPAL_CLIENT_ID, secret = process.env.PAYPAL_CLIENT_SECRET
  if (!id || !secret) return null
  const authorization = Buffer.from(`${id}:${secret}`).toString('base64')
  const response = await fetch(`${baseUrl()}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${authorization}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials', cache: 'no-store' })
  const result = await response.json()
  return response.ok ? result.access_token as string : null
}
// ── Comprobantes de cobro ────────────────────────────────────────────────────
// PayPal manda BILLING.SUBSCRIPTION.* al crear/cambiar la suscripción, pero el
// cobro real viaja en PAYMENT.SALE.COMPLETED: ahí vienen monto, moneda, id de
// transacción y el link al recibo. Sin esta rama no queda registro de ningún
// pago ni de cuándo empezó a pagar el cliente (`subscriptions.current_period_start`
// lo sobrescribe cada renovación). Ver docs/PLAN_REGISTRO_PAGOS_COMPROBANTES.md.
type PayPalSale = {
  id?: string
  sale_id?: string
  billing_agreement_id?: string
  amount?: { total?: string; currency?: string }
  total?: string
  create_time?: string
  links?: Array<{ rel?: string; href?: string }>
}

const LEDGER_CURRENCIES = new Set(['USD', 'EUR', 'MXN', 'CLP', 'COP', 'ARS', 'BRL', 'GBP'])

function receiptLink(resource: PayPalSale) {
  return resource.links?.find((link) => link.rel === 'self')?.href ?? null
}

async function recordSaleCompleted(resource: PayPalSale, accessToken: string) {
  const paypalSubscriptionId = resource.billing_agreement_id
  const saleId = resource.id
  // Un cobro de suscripción trae billing_agreement_id = id de la suscripción.
  // Si falta, el pago NO se registra: se deja rastro en logs para no perderlo
  // en silencio (es la única forma de enterarse si PayPal cambia el formato).
  if (!paypalSubscriptionId || !saleId) {
    console.error('[paypal/webhook] PAYMENT.SALE sin billing_agreement_id o sin id; no se registra', { saleId, paypalSubscriptionId })
    return NextResponse.json({ received: true })
  }

  const admin = createAdminClient()
  const { data: subscription, error: lookupError } = await admin
    .from('subscriptions')
    .select('id, organization_id, current_period_start, current_period_end, metadata')
    .eq('paypal_subscription_id', paypalSubscriptionId)
    .maybeSingle()
  if (lookupError) {
    console.error('[paypal/webhook] lookup de suscripción falló', lookupError.message)
    return NextResponse.json({ error: 'Unable to record payment' }, { status: 500 })
  }
  // Cobro de una suscripción que no está en la base: no se inventa la fila,
  // pero queda registrado en logs — es exactamente el caso que dejaría un pago
  // real sin rastro en SCENCE.
  if (!subscription) {
    console.error('[paypal/webhook] cobro de una suscripción que no existe en la base', { paypalSubscriptionId, saleId })
    return NextResponse.json({ received: true })
  }

  const amount = Number(resource.amount?.total ?? resource.total)
  const currency = String(resource.amount?.currency ?? '').toUpperCase()
  if (!Number.isFinite(amount) || amount <= 0 || !LEDGER_CURRENCIES.has(currency)) {
    console.error('[paypal/webhook] cobro con monto o moneda inválidos', saleId, resource.amount)
    return NextResponse.json({ received: true })
  }

  const linkedInfluencerId = (subscription.metadata as { influencer_id?: string } | null)?.influencer_id ?? null
  // subscription_payments.influencer_id tiene FK a influencers: si la ficha ya
  // no existe, el insert fallaba (23503), la ruta respondía 500 y PayPal
  // reintentaba sin fin: el cobro nunca quedaba registrado. Se registra el
  // pago igual (sin vínculo) y queda rastro para re-vincular.
  let influencerId = linkedInfluencerId
  if (linkedInfluencerId) {
    const { data: linked, error: linkedError } = await admin.from('influencers').select('id').eq('id', linkedInfluencerId).maybeSingle()
    if (linkedError) {
      console.error('[paypal/webhook] lookup de influencer falló', linkedError.message)
      return NextResponse.json({ error: 'Unable to record payment' }, { status: 500 })
    }
    if (!linked) {
      console.error('[paypal/webhook] INFLUENCER_PRO_ORPHAN: cobro de una suscripción Pro sin ficha; se registra sin vínculo', { paypalSubscriptionId, saleId, linkedInfluencerId })
      influencerId = null
    }
  }
  const isInfluencerPayment = Boolean(linkedInfluencerId)
  const row = {
    subscription_id: subscription.id,
    organization_id: subscription.organization_id,
    influencer_id: influencerId,
    payer_type: isInfluencerPayment ? 'influencer' : 'brand',
    gateway: 'paypal',
    gateway_payment_id: saleId,
    payment_method: 'paypal',
    concept: isInfluencerPayment ? 'Suscripción SCENCE Pro' : 'Suscripción SCENCE — plan de marca',
    amount,
    currency,
    status: 'completed',
    paid_at: resource.create_time ?? new Date().toISOString(),
    // period_start / period_end quedan NULL a propósito: `subscriptions`
    // guarda current_period_start = start_time de PayPal, que es el inicio
    // ORIGINAL de la suscripción y no rota por ciclo. Copiarlo acá haría que
    // todos los cobros de una misma suscripción cargaran el mismo período.
    // Calcular el período real exige una llamada extra a PayPal por cobro;
    // fuera de alcance por ahora.
    receipt_url: receiptLink(resource),
  }

  // Idempotente: PayPal reintenta el mismo evento y la constraint
  // (gateway, gateway_payment_id) evita duplicar el cobro.
  const { error } = await admin
    .from('subscription_payments')
    .upsert(row, { onConflict: 'gateway,gateway_payment_id', ignoreDuplicates: true })
  if (error) {
    console.error('[paypal/webhook] no se pudo registrar el pago', error.message)
    return NextResponse.json({ error: 'Unable to record payment' }, { status: 500 })
  }

  // Influencer Pro: un cobro (alta o renovación) también re-sincroniza la
  // suscripción con PayPal. PayPal no siempre manda BILLING.SUBSCRIPTION.* al
  // renovar, y sin esto current_period_end quedaba en la fecha del cobro
  // anterior (caso real: renovación del 06-10 sin adelantar el período).
  if (isInfluencerPayment) {
    const detailsResponse = await fetch(`${baseUrl()}/v1/billing/subscriptions/${encodeURIComponent(paypalSubscriptionId)}`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' })
    const details = await detailsResponse.json().catch(() => null)
    if (!detailsResponse.ok || !details) {
      // El pago ya quedó registrado (idempotente): el reintento solo re-sincroniza.
      console.error('[paypal/webhook] cobro registrado pero no se pudo leer la suscripción en PayPal; se pide reintento', { paypalSubscriptionId, saleId })
      return NextResponse.json({ error: 'Unable to read PayPal subscription' }, { status: 502 })
    }
    const result = await syncInfluencerSubscription(paypalSubscriptionId, details)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 })
  }
  return NextResponse.json({ received: true })
}

async function recordSaleRefunded(resource: PayPalSale) {
  // En un refund el `id` es el del reembolso; el cobro original es `sale_id`.
  const saleId = resource.sale_id
  if (!saleId) return NextResponse.json({ received: true })
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('subscription_payments')
    .update({ status: 'refunded', updated_at: new Date().toISOString() })
    .eq('gateway', 'paypal')
    .eq('gateway_payment_id', saleId)
    .select('id')
  if (error) {
    console.error('[paypal/webhook] no se pudo marcar el reembolso', error.message)
    return NextResponse.json({ error: 'Unable to record refund' }, { status: 500 })
  }
  // Un UPDATE que no matchea nada no es error para PostgREST. Si el reembolso
  // corresponde a un cobro anterior al ledger, hay que saberlo.
  if ((data ?? []).length === 0) console.error('[paypal/webhook] reembolso sin cobro asociado en el ledger', { saleId })
  return NextResponse.json({ received: true })
}

// ── Influencer Pro: sincronización con PayPal ────────────────────────────────
// Una sola función para BILLING.SUBSCRIPTION.* y PAYMENT.SALE.COMPLETED. Lee el
// estado ACTUAL en PayPal (no el payload del evento): duplicados, eventos
// atrasados y fuera de orden convergen a la misma fila (ver
// buildInfluencerSubscriptionRow). Devuelve ok:false solo ante errores de base,
// para que la ruta responda 500 y PayPal reintente.
async function syncInfluencerSubscription(
  paypalSubscriptionId: string,
  details: PayPalSubscriptionSnapshot & { custom_id?: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const influencerRef = parseInfluencerReference(details.custom_id)
  if (!influencerRef) return { ok: true }
  const admin = createAdminClient()
  const [referenced, planResult, existingResult] = await Promise.all([
    admin.from('influencers').select('id, organization_id, user_id').eq('id', influencerRef.influencerId).maybeSingle(),
    admin.from('subscription_plans').select('id').eq('tier', 'pro').eq('is_active', true).maybeSingle(),
    admin.from('subscriptions').select('id, metadata, current_period_end, canceled_at').eq('paypal_subscription_id', paypalSubscriptionId).maybeSingle(),
  ])
  const lookupError = referenced.error ?? planResult.error ?? existingResult.error
  if (lookupError) {
    console.error('[paypal/webhook] lookup falló; se pide reintento', { paypalSubscriptionId, error: lookupError.message })
    return { ok: false, error: 'Unable to read influencer subscription' }
  }
  const existing = existingResult.data
  // El custom_id de PayPal queda fijo al crear la suscripción. Si esa ficha ya
  // no existe (fusionada, borrada y re-vinculada), manda la influencer que la
  // fila de SCENCE tiene en metadata.influencer_id (fuente de verdad del Pro).
  // Último respaldo: identidad estable. Si la ficha se borró y el usuario
  // tiene una ficha nueva, la suscripción se re-vincula a esa ficha
  // (buildInfluencerSubscriptionRow deja relinked_from).
  const linkedMetadata = existing?.metadata as { influencer_id?: string; user_id?: string } | null
  const linkedInfluencerId = linkedMetadata?.influencer_id
  // Orden: ficha vinculada en SCENCE (fuente de verdad) → ficha del custom_id
  // → ficha actual del mismo usuario.
  let influencer = referenced.data
  if (linkedInfluencerId && linkedInfluencerId !== influencerRef.influencerId) {
    const linked = await admin.from('influencers').select('id, organization_id, user_id').eq('id', linkedInfluencerId).maybeSingle()
    if (linked.error) return { ok: false, error: 'Unable to read linked influencer' }
    influencer = linked.data ?? influencer
  }
  if (!influencer && linkedMetadata?.user_id) {
    const byUser = await admin.from('influencers').select('id, organization_id, user_id').eq('user_id', linkedMetadata.user_id).maybeSingle()
    if (byUser.error) return { ok: false, error: 'Unable to read influencer by user' }
    influencer = byUser.data
  }
  if (!planResult.data) {
    console.error('[paypal/webhook] no hay plan pro activo en subscription_plans', { paypalSubscriptionId })
    return { ok: false, error: 'Pro plan is not configured' }
  }
  if (!influencer?.organization_id) {
    // Suscripción pagada sin ficha: NO se inventa un vínculo, pero queda rastro.
    // Reintentar no lo resuelve; se corrige re-vinculando metadata.influencer_id.
    console.error('[paypal/webhook] INFLUENCER_PRO_ORPHAN: la suscripción no tiene ficha de influencer; no se sincroniza', {
      paypalSubscriptionId, customIdInfluencer: influencerRef.influencerId, linkedInfluencerId: linkedInfluencerId ?? null, paypalStatus: details.status ?? null,
    })
    return { ok: true }
  }
  const row = buildInfluencerSubscriptionRow({
    details, paypalSubscriptionId, existing: existing ?? null,
    influencer: { id: influencer.id, organization_id: influencer.organization_id, user_id: influencer.user_id },
    planId: planResult.data.id, campaignId: influencerRef.campaignId,
  })
  const { error } = existing
    ? await admin.from('subscriptions').update(row).eq('id', existing.id)
    : await admin.from('subscriptions').insert(row)
  if (error) {
    console.error('[paypal/webhook] no se pudo guardar la suscripción Pro', { paypalSubscriptionId, error: error.message })
    return { ok: false, error: 'Unable to sync influencer subscription' }
  }
  // Re-vínculo a una ficha nueva: los cobros que quedaron sin ficha vuelven a ella.
  if (existing && linkedInfluencerId && linkedInfluencerId !== influencer.id) {
    console.info('[paypal/webhook] suscripción Pro re-vinculada', { paypalSubscriptionId, from: linkedInfluencerId, to: influencer.id })
    const { error: paymentsError } = await admin.from('subscription_payments')
      .update({ influencer_id: influencer.id, updated_at: new Date().toISOString() })
      .eq('subscription_id', existing.id)
      .is('influencer_id', null)
    if (paymentsError) return { ok: false, error: 'Unable to relink payments' }
  }
  return { ok: true }
}

function reference(value?: string) { const [organizationId, planId, tier] = (value ?? '').split(':'); return organizationId && planId && tier ? { organizationId, planId, tier } : null }
export async function POST(request: NextRequest) {
  const event = await request.json().catch(() => null)
  // FIX (2026-09-06): esta línea leía solo PAYPAL_WEBHOOK_ID, pero la variable
  // que existe en el entorno se llama PAYPAL_INFLUENCER_WEBHOOK_ID. Con el
  // nombre desalineado la ruta devolvía 503 en TODO evento y ninguna
  // suscripción llegaba a activarse. Se aceptan los dos nombres para no
  // depender de cuál esté cargada.
  const accessToken = await token()
  const webhookId = process.env.PAYPAL_WEBHOOK_ID ?? process.env.PAYPAL_INFLUENCER_WEBHOOK_ID
  if (!event) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  if (!accessToken || !webhookId) return NextResponse.json({ error: 'PayPal webhook is not configured' }, { status: 503 })
  const verification = await fetch(`${baseUrl()}/v1/notifications/verify-webhook-signature`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ auth_algo: request.headers.get('paypal-auth-algo'), cert_url: request.headers.get('paypal-cert-url'), transmission_id: request.headers.get('paypal-transmission-id'), transmission_sig: request.headers.get('paypal-transmission-sig'), transmission_time: request.headers.get('paypal-transmission-time'), webhook_id: webhookId, webhook_event: event }) })
  const verified = await verification.json().catch(() => null)
  if (!verification.ok || verified?.verification_status !== 'SUCCESS') return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  const eventType = String(event.event_type ?? '')
  if (eventType === 'PAYMENT.SALE.COMPLETED') return recordSaleCompleted((event.resource ?? {}) as PayPalSale, accessToken)
  if (eventType === 'PAYMENT.SALE.REFUNDED') return recordSaleRefunded((event.resource ?? {}) as PayPalSale)
  if (!eventType.startsWith('BILLING.SUBSCRIPTION.')) return NextResponse.json({ received: true })
  const id = String(event.resource?.id ?? '')
  if (!id) return NextResponse.json({ received: true })
  const detailsResponse = await fetch(`${baseUrl()}/v1/billing/subscriptions/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' })
  const subscription = await detailsResponse.json().catch(() => null)
  // Sin el estado real de PayPal no se puede sincronizar: 502 para que PayPal
  // reintente. Antes respondía 200 y el evento se perdía en silencio.
  if (!detailsResponse.ok || !subscription) {
    console.error('[paypal/webhook] no se pudo leer la suscripción en PayPal; se pide reintento', { id, eventType, status: detailsResponse.status })
    return NextResponse.json({ error: 'Unable to read PayPal subscription' }, { status: 502 })
  }
  if (parseInfluencerReference(subscription.custom_id)) {
    const result = await syncInfluencerSubscription(id, subscription as PayPalSubscriptionSnapshot & { custom_id?: string })
    return result.ok ? NextResponse.json({ received: true }) : NextResponse.json({ error: result.error }, { status: 500 })
  }
  const ref = reference(subscription?.custom_id)
  if (!detailsResponse.ok || !ref) return NextResponse.json({ received: true })
  const status = STATUS_MAP[subscription.status] ?? 'incomplete', start = subscription.start_time ?? subscription.create_time ?? new Date().toISOString()
  const admin = createAdminClient()
  const { data: existing, error: existingError } = await admin.from('subscriptions').select('id, organization_id, metadata, current_period_end, canceled_at').eq('paypal_subscription_id', id).maybeSingle()
  if (existingError) return NextResponse.json({ error: 'Unable to read subscription' }, { status: 500 })
  // Un evento de marca nunca modifica la fila de otra organización ni de una influencer.
  if (existing && (existing.organization_id !== ref.organizationId || isInfluencerSubscription(existing.metadata))) {
    console.error('[paypal/webhook] suscripción de marca no coincide con la fila existente; no se modifica', { id })
    return NextResponse.json({ received: true })
  }
  // El plan pagado vive en la suscripción (resolveBrandPlanAccess): cancelar =
  // no renovar; el acceso sigue hasta current_period_end. Una cancelación NUNCA
  // retrocede el fin del período (PayPal no informa next_billing_time al
  // cancelar). past_due no da acceso. El override administrativo no se toca.
  const reportedEnd = payPalPaidThrough(subscription) ?? start
  const storedEnd = existing?.current_period_end ? Date.parse(existing.current_period_end) : NaN
  const end = status === 'canceled' && Number.isFinite(storedEnd) && storedEnd > Date.parse(reportedEnd)
    ? new Date(storedEnd).toISOString()
    : reportedEnd
  const metadata = { ...((existing?.metadata as Record<string, unknown> | null) ?? {}), account_type: 'brand' }
  const canceledAt = status === 'canceled' ? (existing?.canceled_at ?? new Date().toISOString()) : null
  const row = { organization_id: ref.organizationId, plan_id: ref.planId, status, current_period_start: start, current_period_end: end, paypal_subscription_id: id, paypal_payer_id: subscription.subscriber?.payer_id ?? null, metadata, canceled_at: canceledAt, updated_at: new Date().toISOString() }
  const { error } = existing ? await admin.from('subscriptions').update(row).eq('id', existing.id) : await admin.from('subscriptions').insert(row)
  if (error) return NextResponse.json({ error: 'Unable to sync subscription' }, { status: 500 })
  if (status === 'active') {
    const { error: brandError } = await admin.from('brands').update({ status: 'approved' }).eq('organization_id', ref.organizationId).eq('status', 'suspended')
    if (brandError) return NextResponse.json({ error: 'Unable to reactivate brand' }, { status: 500 })
  }
  return NextResponse.json({ received: true })
}
