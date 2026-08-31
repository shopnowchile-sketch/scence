import { NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { hasActiveCampaignCommitment } from '@/lib/influencer-pro-commitment'

const BLOCKED_MESSAGE = 'Tu suscripción Pro está vinculada a una campaña. Podrás cancelarla cuando la campaña haya terminado y hayas completado todos tus entregables.'
const PENDING_MESSAGE = 'Tu campaña ya terminó, pero aún tienes entregables pendientes. Completa todos tus entregables para poder cancelar tu suscripción.'
const paypalBaseUrl = () => process.env.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'

async function getPayPalToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID, clientSecret = process.env.PAYPAL_CLIENT_SECRET
  if (!clientId || !clientSecret) return null
  const authorization = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const response = await fetch(`${paypalBaseUrl()}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${authorization}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials', cache: 'no-store' })
  const result = await response.json().catch(() => null)
  return response.ok ? result?.access_token as string | undefined : null
}

export async function POST() {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const { data: influencer } = await admin.from('influencers').select('id').eq('user_id', user.id).maybeSingle()
  if (!influencer) return NextResponse.json({ error: 'Not an influencer account' }, { status: 403 })

  const { data: subscriptions, error: subscriptionError } = await admin.from('subscriptions')
    .select('id, paypal_subscription_id, metadata, subscription_plans!inner(tier)')
    .in('status', ['active', 'trialing']).not('paypal_subscription_id', 'is', null)
    .eq('metadata->>influencer_id', influencer.id).eq('subscription_plans.tier', 'pro')
  if (subscriptionError) return NextResponse.json({ error: 'No se pudo consultar tu suscripción.' }, { status: 500 })
  const subscription = subscriptions?.[0]
  if (!subscription?.paypal_subscription_id) return NextResponse.json({ error: 'No tienes una suscripción Pro activa.' }, { status: 404 })

  try {
    const commitment = await hasActiveCampaignCommitment(admin, influencer.id, subscription.metadata)
    if (commitment.blocked) return NextResponse.json({ error: commitment.reason === 'deliverables_pending' ? PENDING_MESSAGE : BLOCKED_MESSAGE, campaign: commitment.commitment }, { status: 409 })
  } catch (error) {
    console.error('[POST /api/influencer/paypal/cancel] commitment check:', error)
    return NextResponse.json({ error: 'No se pudo validar el compromiso de campaña.' }, { status: 500 })
  }

  const accessToken = await getPayPalToken()
  if (!accessToken) return NextResponse.json({ error: 'PayPal no está configurado.' }, { status: 503 })
  const cancelResponse = await fetch(`${paypalBaseUrl()}/v1/billing/subscriptions/${encodeURIComponent(subscription.paypal_subscription_id)}/cancel`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'Cancelación solicitada por influencer en SCENCE' }) })
  if (!cancelResponse.ok && cancelResponse.status !== 204) return NextResponse.json({ error: 'PayPal no pudo cancelar la suscripción.' }, { status: 502 })

  const canceledAt = new Date().toISOString()
  const { error: updateError } = await admin.from('subscriptions').update({ status: 'canceled', canceled_at: canceledAt, updated_at: canceledAt, metadata: { ...(subscription.metadata ?? {}), cancel_at_period_end: true } }).eq('id', subscription.id)
  if (updateError) return NextResponse.json({ error: 'PayPal canceló la suscripción, pero no se pudo sincronizar SCENCE.' }, { status: 500 })
  return NextResponse.json({ canceled: true, canceled_at: canceledAt })
}
