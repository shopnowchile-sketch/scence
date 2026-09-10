import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { parseInfluencerReference } from '@/lib/influencer-paypal'

const STATUS_MAP: Record<string, string> = { ACTIVE: 'active', APPROVAL_PENDING: 'incomplete', SUSPENDED: 'past_due', CANCELLED: 'canceled', EXPIRED: 'canceled' }
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

async function recordSaleCompleted(resource: PayPalSale) {
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

  const influencerId = (subscription.metadata as { influencer_id?: string } | null)?.influencer_id ?? null
  const row = {
    subscription_id: subscription.id,
    organization_id: subscription.organization_id,
    influencer_id: influencerId,
    payer_type: influencerId ? 'influencer' : 'brand',
    gateway: 'paypal',
    gateway_payment_id: saleId,
    payment_method: 'paypal',
    concept: influencerId ? 'Suscripción SCENCE Pro' : 'Suscripción SCENCE — plan de marca',
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
  if (eventType === 'PAYMENT.SALE.COMPLETED') return recordSaleCompleted((event.resource ?? {}) as PayPalSale)
  if (eventType === 'PAYMENT.SALE.REFUNDED') return recordSaleRefunded((event.resource ?? {}) as PayPalSale)
  if (!eventType.startsWith('BILLING.SUBSCRIPTION.')) return NextResponse.json({ received: true })
  const id = String(event.resource?.id ?? '')
  if (!id) return NextResponse.json({ received: true })
  const detailsResponse = await fetch(`${baseUrl()}/v1/billing/subscriptions/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' })
  const subscription = await detailsResponse.json().catch(() => null)
  const influencerRef = parseInfluencerReference(subscription?.custom_id)
  if (detailsResponse.ok && influencerRef) {
    const admin = createAdminClient()
    const [{ data: influencer }, { data: plan }, { data: existing }] = await Promise.all([
      admin.from('influencers').select('id, organization_id').eq('id', influencerRef.influencerId).maybeSingle(),
      admin.from('subscription_plans').select('id').eq('tier', 'pro').eq('is_active', true).maybeSingle(),
      admin.from('subscriptions').select('id, metadata').eq('paypal_subscription_id', id).maybeSingle(),
    ])
    if (!influencer?.organization_id || !plan) return NextResponse.json({ received: true })
    const status = STATUS_MAP[subscription.status] ?? 'incomplete'
    const start = subscription.start_time ?? subscription.create_time ?? new Date().toISOString()
    const end = subscription.billing_info?.next_billing_time ?? start
    const metadata = existing?.metadata ?? { account_type: 'influencer', influencer_id: influencer.id, campaign_commitments: influencerRef.campaignId ? [influencerRef.campaignId] : [] }
    const row = { organization_id: influencer.organization_id, plan_id: plan.id, status, current_period_start: start, current_period_end: end, paypal_subscription_id: id, paypal_payer_id: subscription.subscriber?.payer_id ?? null, metadata, canceled_at: status === 'canceled' ? new Date().toISOString() : null, updated_at: new Date().toISOString() }
    const { error } = existing ? await admin.from('subscriptions').update(row).eq('id', existing.id) : await admin.from('subscriptions').insert(row)
    if (error) return NextResponse.json({ error: 'Unable to sync influencer subscription' }, { status: 500 })
    return NextResponse.json({ received: true })
  }
  const ref = reference(subscription?.custom_id)
  if (!detailsResponse.ok || !ref) return NextResponse.json({ received: true })
  const status = STATUS_MAP[subscription.status] ?? 'incomplete', start = subscription.start_time ?? subscription.create_time ?? new Date().toISOString(), end = subscription.billing_info?.next_billing_time ?? start
  const admin = createAdminClient()
  const { data: existing } = await admin.from('subscriptions').select('id').eq('paypal_subscription_id', id).maybeSingle()
  const row = { organization_id: ref.organizationId, plan_id: ref.planId, status, current_period_start: start, current_period_end: end, paypal_subscription_id: id, paypal_payer_id: subscription.subscriber?.payer_id ?? null, canceled_at: status === 'canceled' ? new Date().toISOString() : null, updated_at: new Date().toISOString() }
  const { error } = existing ? await admin.from('subscriptions').update(row).eq('id', existing.id) : await admin.from('subscriptions').insert(row)
  if (error) return NextResponse.json({ error: 'Unable to sync subscription' }, { status: 500 })
  await admin.from('organizations').update({ subscription_plan: status === 'active' ? ref.tier : 'basic' }).eq('id', ref.organizationId)
  if (status === 'active') {
    await admin.from('brands').update({ status: 'approved' }).eq('organization_id', ref.organizationId).eq('status', 'suspended')
  }
  return NextResponse.json({ received: true })
}
