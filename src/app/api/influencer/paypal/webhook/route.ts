import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getInfluencerPayPalToken, influencerPayPalBaseUrl, parseInfluencerReference } from '@/lib/influencer-paypal'

const STATUS_MAP: Record<string, string> = {
  ACTIVE: 'active',
  APPROVAL_PENDING: 'incomplete',
  SUSPENDED: 'past_due',
  CANCELLED: 'canceled',
  EXPIRED: 'canceled',
}

export async function POST(request: NextRequest) {
  const event = await request.json().catch(() => null)
  if (!event) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const accessToken = await getInfluencerPayPalToken()
  const webhookId = process.env.PAYPAL_INFLUENCER_WEBHOOK_ID
  if (!accessToken || !webhookId) {
    return NextResponse.json({ error: 'Influencer PayPal webhook is not configured' }, { status: 503 })
  }

  const verification = await fetch(`${influencerPayPalBaseUrl()}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auth_algo: request.headers.get('paypal-auth-algo'),
      cert_url: request.headers.get('paypal-cert-url'),
      transmission_id: request.headers.get('paypal-transmission-id'),
      transmission_sig: request.headers.get('paypal-transmission-sig'),
      transmission_time: request.headers.get('paypal-transmission-time'),
      webhook_id: webhookId,
      webhook_event: event,
    }),
  })
  const verified = await verification.json().catch(() => null)
  if (!verification.ok || verified?.verification_status !== 'SUCCESS') {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  if (!String(event.event_type ?? '').startsWith('BILLING.SUBSCRIPTION.')) {
    return NextResponse.json({ received: true })
  }

  const subscriptionId = String(event.resource?.id ?? '')
  if (!subscriptionId) return NextResponse.json({ received: true })

  const detailsResponse = await fetch(`${influencerPayPalBaseUrl()}/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  })
  const subscription = await detailsResponse.json().catch(() => null)
  const reference = parseInfluencerReference(subscription?.custom_id)
  const influencerPlanId = process.env.PAYPAL_INFLUENCER_PRO_PLAN_ID
  if (!detailsResponse.ok || !reference || !influencerPlanId || subscription?.plan_id !== influencerPlanId) {
    return NextResponse.json({ received: true })
  }

  const admin = createAdminClient()
  const [{ data: influencer }, { data: plan }, { data: existing }] = await Promise.all([
    admin.from('influencers').select('id, organization_id').eq('id', reference.influencerId).maybeSingle(),
    admin.from('subscription_plans').select('id').eq('tier', 'pro').eq('is_active', true).maybeSingle(),
    admin.from('subscriptions').select('id, metadata').eq('paypal_subscription_id', subscriptionId).maybeSingle(),
  ])
  if (!influencer?.organization_id || !plan) return NextResponse.json({ received: true })

  const status = STATUS_MAP[subscription.status] ?? 'incomplete'
  const start = subscription.start_time ?? subscription.create_time ?? new Date().toISOString()
  const end = subscription.billing_info?.next_billing_time ?? start
  const existingMetadata = (existing?.metadata ?? {}) as Record<string, unknown>
  const campaignCommitments = Array.isArray(existingMetadata.campaign_commitments)
    ? existingMetadata.campaign_commitments
    : (reference.campaignId ? [reference.campaignId] : [])
  const updatedAt = new Date().toISOString()
  const row = {
    organization_id: influencer.organization_id,
    plan_id: plan.id,
    status,
    current_period_start: start,
    current_period_end: end,
    paypal_subscription_id: subscriptionId,
    paypal_payer_id: subscription.subscriber?.payer_id ?? null,
    metadata: {
      ...existingMetadata,
      account_type: 'influencer',
      payment_provider: 'paypal',
      influencer_id: influencer.id,
      paypal_plan_id: influencerPlanId,
      campaign_commitments: campaignCommitments,
    },
    canceled_at: status === 'canceled' ? updatedAt : null,
    updated_at: updatedAt,
  }
  const { error } = existing
    ? await admin.from('subscriptions').update(row).eq('id', existing.id)
    : await admin.from('subscriptions').insert(row)
  if (error) return NextResponse.json({ error: 'Unable to sync influencer subscription' }, { status: 500 })

  return NextResponse.json({ received: true })
}
