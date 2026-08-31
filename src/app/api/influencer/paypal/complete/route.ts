import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { getInfluencerPayPalToken, influencerPayPalBaseUrl, parseInfluencerReference } from '@/lib/influencer-paypal'

export async function POST(request: NextRequest) {
  const subscriptionId = request.nextUrl.searchParams.get('subscription_id')
  if (!subscriptionId) return NextResponse.json({ error: 'Falta la suscripción de PayPal.' }, { status: 422 })
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const { data: influencer } = await admin.from('influencers').select('id, organization_id, is_active').eq('user_id', user.id).maybeSingle()
  if (!influencer?.is_active || !influencer.organization_id) return NextResponse.json({ error: 'Cuenta de influencer inválida.' }, { status: 403 })
  const accessToken = await getInfluencerPayPalToken()
  if (!accessToken) return NextResponse.json({ error: 'PayPal no está configurado.' }, { status: 503 })
  const detailsResponse = await fetch(`${influencerPayPalBaseUrl()}/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' })
  const subscription = await detailsResponse.json().catch(() => null)
  const reference = parseInfluencerReference(subscription?.custom_id)
  if (!detailsResponse.ok || subscription?.status !== 'ACTIVE' || !reference || reference.influencerId !== influencer.id) return NextResponse.json({ error: 'La suscripción aún no está activa.' }, { status: 409 })
  const { data: plan } = await admin.from('subscription_plans').select('id').eq('tier', 'pro').eq('is_active', true).maybeSingle()
  if (!plan) return NextResponse.json({ error: 'El Plan Pro no está configurado en SCENCE.' }, { status: 500 })
  const metadata = { account_type: 'influencer', influencer_id: influencer.id, campaign_commitments: reference.campaignId ? [reference.campaignId] : [] }
  const row = { organization_id: influencer.organization_id, plan_id: plan.id, status: 'active', current_period_start: subscription.start_time ?? subscription.create_time, current_period_end: subscription.billing_info?.next_billing_time ?? subscription.start_time ?? subscription.create_time, paypal_subscription_id: subscriptionId, paypal_payer_id: subscription.subscriber?.payer_id ?? null, metadata, canceled_at: null, updated_at: new Date().toISOString() }
  const { data: existing } = await admin.from('subscriptions').select('id').eq('paypal_subscription_id', subscriptionId).maybeSingle()
  const result = existing ? await admin.from('subscriptions').update(row).eq('id', existing.id) : await admin.from('subscriptions').insert(row)
  if (result.error) return NextResponse.json({ error: 'No se pudo guardar la suscripción Pro.' }, { status: 500 })
  return NextResponse.json({ plan: 'pro' })
}
