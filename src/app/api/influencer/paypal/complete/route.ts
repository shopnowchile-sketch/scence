import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { buildInfluencerSubscriptionRow, getInfluencerPayPalToken, influencerPayPalBaseUrl, parseInfluencerReference } from '@/lib/influencer-paypal'

export async function POST(request: NextRequest) {
  const subscriptionId = request.nextUrl.searchParams.get('subscription_id')
  if (!subscriptionId) return NextResponse.json({ error: 'Falta la suscripción de PayPal.' }, { status: 422 })
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const { data: influencer } = await admin.from('influencers').select('id, organization_id, user_id, is_active').eq('user_id', user.id).maybeSingle()
  if (!influencer?.is_active || !influencer.organization_id) return NextResponse.json({ error: 'Cuenta de influencer inválida.' }, { status: 403 })
  const accessToken = await getInfluencerPayPalToken()
  if (!accessToken) return NextResponse.json({ error: 'PayPal no está configurado.' }, { status: 503 })
  const detailsResponse = await fetch(`${influencerPayPalBaseUrl()}/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' })
  const subscription = await detailsResponse.json().catch(() => null)
  const reference = parseInfluencerReference(subscription?.custom_id)
  if (!detailsResponse.ok || subscription?.status !== 'ACTIVE' || !reference || reference.influencerId !== influencer.id) return NextResponse.json({ error: 'La suscripción aún no está activa.' }, { status: 409 })
  const [{ data: plan, error: planError }, { data: existing, error: existingError }] = await Promise.all([
    admin.from('subscription_plans').select('id').eq('tier', 'pro').eq('is_active', true).maybeSingle(),
    admin.from('subscriptions').select('id, metadata, current_period_end, canceled_at').eq('paypal_subscription_id', subscriptionId).maybeSingle(),
  ])
  if (planError || existingError) return NextResponse.json({ error: 'No se pudo validar la suscripción Pro.' }, { status: 500 })
  if (!plan) return NextResponse.json({ error: 'El Plan Pro no está configurado en SCENCE.' }, { status: 500 })
  // Misma construcción que el webhook (buildInfluencerSubscriptionRow): si el
  // webhook llegó primero, no se pisa su metadata ni se retrocede el período.
  const row = buildInfluencerSubscriptionRow({
    details: subscription, paypalSubscriptionId: subscriptionId, existing: existing ?? null,
    influencer: { id: influencer.id, organization_id: influencer.organization_id, user_id: influencer.user_id },
    planId: plan.id, campaignId: reference.campaignId,
  })
  const result = existing ? await admin.from('subscriptions').update(row).eq('id', existing.id) : await admin.from('subscriptions').insert(row)
  // Carrera con el webhook: ambos leen "no existe" e insertan; el UNIQUE de
  // paypal_subscription_id rechaza al segundo. La fila ya quedó con el estado
  // de PayPal, así que el checkout está completo.
  if (result.error?.code === '23505') return NextResponse.json({ plan: 'pro' })
  if (result.error) {
    console.error('[POST /api/influencer/paypal/complete] no se pudo guardar la suscripción Pro', { subscriptionId, error: result.error.message })
    return NextResponse.json({ error: 'No se pudo guardar la suscripción Pro.' }, { status: 500 })
  }
  return NextResponse.json({ plan: 'pro' })
}
