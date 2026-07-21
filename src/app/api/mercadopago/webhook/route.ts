import { NextRequest, NextResponse } from 'next/server'
import { WebhookSignatureValidator } from 'mercadopago'
import { createAdminClient } from '@/lib/supabase/server'

const STATUS_MAP: Record<string, string> = {
  authorized: 'active',
  pending: 'incomplete',
  paused: 'past_due',
  cancelled: 'canceled',
  canceled: 'canceled',
}

type MercadoPagoSubscription = {
  id: string
  status?: string
  external_reference?: string
  payer_id?: number | string | null
  date_created?: string | null
  next_payment_date?: string | null
  auto_recurring?: {
    start_date?: string | null
    end_date?: string | null
  }
}

function parseReference(reference: string | undefined) {
  if (!reference) return null
  const [organizationId, planId, tier] = reference.split(':')
  if (!organizationId || !planId || !tier) return null
  return { organizationId, planId, tier }
}

export async function POST(request: NextRequest) {
  let body: { type?: string; data?: { id?: string | number } } = {}

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const dataId = String(
    request.nextUrl.searchParams.get('data.id') ??
    request.nextUrl.searchParams.get('id') ??
    body.data?.id ??
    '',
  )

  if (!dataId) {
    return NextResponse.json({ received: true })
  }

  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET
  if (secret) {
    try {
      WebhookSignatureValidator.validate({
        xSignature: request.headers.get('x-signature') ?? '',
        xRequestId: request.headers.get('x-request-id') ?? '',
        dataId,
        secret,
      })
    } catch {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  }

  if (body.type && body.type !== 'subscription_preapproval') {
    return NextResponse.json({ received: true })
  }

  const token = process.env.VERCEL_ENV === 'preview'
    ? process.env.MERCADOPAGO_TEST_ACCESS_TOKEN ?? process.env.MERCADOPAGO_ACCESS_TOKEN
    : process.env.MERCADOPAGO_ACCESS_TOKEN
  if (!token) {
    return NextResponse.json({ error: 'Mercado Pago is not configured' }, { status: 503 })
  }

  const mpResponse = await fetch(`https://api.mercadopago.com/preapproval/${encodeURIComponent(dataId)}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  })

  if (!mpResponse.ok) {
    console.error('[mercadopago/webhook] preapproval fetch failed', await mpResponse.text())
    return NextResponse.json({ error: 'Unable to fetch subscription' }, { status: 502 })
  }

  const subscription = await mpResponse.json() as MercadoPagoSubscription
  const reference = parseReference(subscription.external_reference)

  if (!reference) {
    console.error('[mercadopago/webhook] invalid external_reference', subscription.external_reference)
    return NextResponse.json({ received: true })
  }

  const status = STATUS_MAP[subscription.status ?? ''] ?? 'incomplete'
  const periodStart = subscription.auto_recurring?.start_date ?? subscription.date_created ?? new Date().toISOString()
  const periodEnd = subscription.next_payment_date ?? subscription.auto_recurring?.end_date ?? periodStart
  const canceledAt = status === 'canceled' ? new Date().toISOString() : null

  const admin = createAdminClient()
  const { data: existing } = await admin
    .from('subscriptions')
    .select('id')
    .eq('mercadopago_subscription_id', subscription.id)
    .maybeSingle()

  const row = {
    organization_id: reference.organizationId,
    plan_id: reference.planId,
    status,
    current_period_start: periodStart,
    current_period_end: periodEnd,
    mercadopago_subscription_id: subscription.id,
    mercadopago_payer_id: subscription.payer_id == null ? null : String(subscription.payer_id),
    canceled_at: canceledAt,
    updated_at: new Date().toISOString(),
  }

  const { error } = existing
    ? await admin.from('subscriptions').update(row).eq('id', existing.id)
    : await admin.from('subscriptions').insert(row)

  if (error) {
    console.error('[mercadopago/webhook] subscription upsert failed', error.message)
    return NextResponse.json({ error: 'Unable to sync subscription' }, { status: 500 })
  }

  await admin
    .from('organizations')
    .update({ subscription_plan: status === 'active' ? reference.tier : 'basic' })
    .eq('id', reference.organizationId)

  return NextResponse.json({ received: true })
}
