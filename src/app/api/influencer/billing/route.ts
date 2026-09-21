import { NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { hasActiveCampaignCommitment } from '@/lib/influencer-pro-commitment'
import { isInfluencerPro } from '@/lib/influencer-pro'

export async function GET() {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: influencer } = await admin.from('influencers').select('id, is_active').eq('user_id', user.id).maybeSingle()
  if (!influencer) return NextResponse.json({ error: 'Not an influencer account' }, { status: 403 })

  const { data: subscriptions, error } = await admin.from('subscriptions')
    .select('id, status, current_period_end, started_paying_at, canceled_at, paypal_subscription_id, metadata, plan:subscription_plans(name, tier)')
    .eq('metadata->>influencer_id', influencer.id)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) return NextResponse.json({ error: 'No se pudo consultar tu plan.' }, { status: 500 })

  const subscription = subscriptions?.[0] ?? null
  if (!subscription) return NextResponse.json({ subscription: null, commitment: null, can_cancel: false, is_pro: false, account_active: influencer.is_active, started_paying_at: null, payments: [], total_paid: 0 })

  const { data: payments, error: paymentsError } = await admin
    .from('subscription_payments')
    .select('id, subscription_id, gateway, gateway_payment_id, payment_method, concept, amount, currency, status, paid_at, period_start, period_end, receipt_url')
    .eq('influencer_id', influencer.id)
    .eq('payer_type', 'influencer')
    .order('paid_at', { ascending: false })
    .limit(100)

  if (paymentsError) return NextResponse.json({ error: 'No se pudo consultar tu historial de pagos Pro.' }, { status: 500 })

  const completedPayments = (payments ?? []).filter(payment => payment.status === 'completed')
  const totalPaid = completedPayments.reduce((sum, payment) => sum + Number(payment.amount), 0)

  try {
    const commitment = await hasActiveCampaignCommitment(admin, influencer.id, subscription.metadata)
    const isPro = await isInfluencerPro(admin, influencer.id)
    return NextResponse.json({
      subscription,
      commitment: commitment.commitment,
      can_cancel: ['active', 'trialing'].includes(subscription.status) && !commitment.blocked,
      blocked_reason: commitment.reason,
      is_pro: isPro,
      account_active: influencer.is_active,
      started_paying_at: subscription.started_paying_at ?? completedPayments.at(-1)?.paid_at ?? null,
      payments: payments ?? [],
      total_paid: totalPaid,
      total_paid_currency: completedPayments[0]?.currency ?? null,
    })
  } catch (commitmentError) {
    console.error('[GET /api/influencer/billing] commitment check:', commitmentError)
    return NextResponse.json({ error: 'No se pudo validar el compromiso de campaña.' }, { status: 500 })
  }
}
