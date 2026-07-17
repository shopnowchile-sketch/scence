import { createHmac, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { PLAN_TIERS } from '@/lib/plan-limits'

const STATUS_MAP: Record<string, 'active' | 'paused' | 'canceled'> = {
  authorized: 'active',
  pending: 'paused',
  paused: 'paused',
  cancelled: 'canceled',
  canceled: 'canceled',
}
const DB_TIER: Record<string, string> = { basic: 'starter', growth: 'growth', pro: 'pro' }

type MercadoPagoSubscription = {
  id: string
  status?: string
  preapproval_plan_id?: string | null
  external_reference?: string
  payer_id?: number | string | null
  date_created?: string | null
  next_payment_date?: string | null
  auto_recurring?: { start_date?: string | null; end_date?: string | null }
}

function parseReference(reference: string | undefined) {
  if (!reference) return null
  const [organizationId, planId, tier] = reference.split(':')
  if (!organizationId || !planId || !(PLAN_TIERS as readonly string[]).includes(tier)) return null
  return { organizationId, planId, tier }
}

function validSignature(request: NextRequest, dataId: string, secret: string) {
  const signature = request.headers.get('x-signature') ?? ''
  const requestId = request.headers.get('x-request-id') ?? ''
  const parts = Object.fromEntries(signature.split(',').map(part => part.trim().split('=', 2)))
  const ts = parts.ts
  const received = parts.v1
  if (!ts || !received || !requestId) return false

  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`
  const expected = createHmac('sha256', secret).update(manifest).digest('hex')
  const expectedBuffer = Buffer.from(expected)
  const receivedBuffer = Buffer.from(received)
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer)
}

export async function POST(request: NextRequest) {
  let body: { type?: string; data?: { id?: string | number } } = {}
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const dataId = String(request.nextUrl.searchParams.get('data.id') ?? body.data?.id ?? '')
  if (!dataId) return NextResponse.json({ received: true })

  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET
  if (!secret) {
    console.error('[mercadopago/webhook] MERCADOPAGO_WEBHOOK_SECRET ausente')
    return NextResponse.json({ error: 'Webhook is not configured' }, { status: 503 })
  }
  if (!validSignature(request, dataId, secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  if (body.type && body.type !== 'subscription_preapproval') {
    return NextResponse.json({ received: true })
  }

  const token = process.env.MERCADOPAGO_ACCESS_TOKEN
  if (!token) return NextResponse.json({ error: 'Mercado Pago is not configured' }, { status: 503 })

  const response = await fetch(`https://api.mercadopago.com/preapproval/${encodeURIComponent(dataId)}`, {
    headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
  })
  if (!response.ok) {
    console.error('[mercadopago/webhook] preapproval fetch failed', await response.text())
    return NextResponse.json({ error: 'Unable to fetch subscription' }, { status: 502 })
  }

  const subscription = await response.json() as MercadoPagoSubscription
  const reference = parseReference(subscription.external_reference)
  if (!reference || subscription.id !== dataId) {
    return NextResponse.json({ error: 'Invalid subscription reference' }, { status: 422 })
  }

  const expectedPlanId = process.env[`MERCADOPAGO_${reference.tier.toUpperCase()}_PLAN_ID`]
  if (!expectedPlanId || subscription.preapproval_plan_id !== expectedPlanId) {
    return NextResponse.json({ error: 'Unexpected Mercado Pago plan' }, { status: 422 })
  }

  const status = STATUS_MAP[subscription.status ?? ''] ?? 'paused'
  const periodStart = subscription.auto_recurring?.start_date ?? subscription.date_created ?? new Date().toISOString()
  const periodEnd = subscription.next_payment_date ?? subscription.auto_recurring?.end_date ?? periodStart
  const admin = createAdminClient()

  const { data: planRow } = await admin
    .from('subscription_plans')
    .select('id, tier')
    .eq('id', reference.planId)
    .eq('tier', DB_TIER[reference.tier])
    .eq('is_active', true)
    .maybeSingle()
  if (!planRow) {
    return NextResponse.json({ error: 'Invalid SCENCE plan reference' }, { status: 422 })
  }

  const row = {
    organization_id: reference.organizationId,
    plan_id: reference.planId,
    status,
    current_period_start: periodStart,
    current_period_end: periodEnd,
    mercadopago_subscription_id: subscription.id,
    mercadopago_payer_id: subscription.payer_id == null ? null : String(subscription.payer_id),
    canceled_at: status === 'canceled' ? new Date().toISOString() : null,
    metadata: { provider: 'mercadopago', mercado_pago_status: subscription.status },
    updated_at: new Date().toISOString(),
  }

  const { data: existing } = await admin.from('subscriptions').select('id')
    .eq('mercadopago_subscription_id', subscription.id).maybeSingle()
  const { error } = existing
    ? await admin.from('subscriptions').update(row).eq('id', existing.id)
    : await admin.from('subscriptions').insert(row)
  if (error) {
    console.error('[mercadopago/webhook] subscription upsert failed', error.message)
    return NextResponse.json({ error: 'Unable to sync subscription' }, { status: 500 })
  }

  await admin.from('organizations')
    .update({ subscription_plan: status === 'active' ? reference.tier : 'free', subscription_status: status })
    .eq('id', reference.organizationId)

  return NextResponse.json({ received: true })
}
