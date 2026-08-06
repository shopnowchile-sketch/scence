import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

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
function reference(value?: string) { const [organizationId, planId, tier] = (value ?? '').split(':'); return organizationId && planId && tier ? { organizationId, planId, tier } : null }
export async function POST(request: NextRequest) {
  const event = await request.json().catch(() => null)
  const accessToken = await token(), webhookId = process.env.PAYPAL_WEBHOOK_ID
  if (!event) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  if (!accessToken || !webhookId) return NextResponse.json({ error: 'PayPal webhook is not configured' }, { status: 503 })
  const verification = await fetch(`${baseUrl()}/v1/notifications/verify-webhook-signature`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ auth_algo: request.headers.get('paypal-auth-algo'), cert_url: request.headers.get('paypal-cert-url'), transmission_id: request.headers.get('paypal-transmission-id'), transmission_sig: request.headers.get('paypal-transmission-sig'), transmission_time: request.headers.get('paypal-transmission-time'), webhook_id: webhookId, webhook_event: event }) })
  const verified = await verification.json().catch(() => null)
  if (!verification.ok || verified?.verification_status !== 'SUCCESS') return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  if (!String(event.event_type ?? '').startsWith('BILLING.SUBSCRIPTION.')) return NextResponse.json({ received: true })
  const id = String(event.resource?.id ?? '')
  if (!id) return NextResponse.json({ received: true })
  const detailsResponse = await fetch(`${baseUrl()}/v1/billing/subscriptions/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' })
  const subscription = await detailsResponse.json().catch(() => null)
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
