import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { getOrgId, getUserRole } from '@/lib/supabase/ensureOrg'

async function requireAdmin() {
  const supabase = createServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  const { isAdmin } = orgId ? await getUserRole(user.id, orgId, admin) : { isAdmin: false }
  if (!isAdmin) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { admin }
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const influencerId = request.nextUrl.searchParams.get('influencer_id')
  if (!influencerId) return NextResponse.json({ error: 'influencer_id es requerido.' }, { status: 422 })

  const { data: influencer, error: influencerError } = await auth.admin
    .from('influencers')
    .select('id, display_name, email')
    .eq('id', influencerId)
    .maybeSingle()

  if (influencerError) return NextResponse.json({ error: 'No se pudo consultar la influencer.' }, { status: 500 })
  if (!influencer) return NextResponse.json({ error: 'Influencer no encontrada.' }, { status: 404 })

  const { data: subscriptions, error: subscriptionsError } = await auth.admin
    .from('subscriptions')
    .select('id, status, started_paying_at, current_period_end, created_at')
    .eq('metadata->>influencer_id', influencerId)
    .order('created_at', { ascending: false })
    .limit(1)

  if (subscriptionsError) return NextResponse.json({ error: 'No se pudo consultar la suscripción Pro.' }, { status: 500 })

  const latestSubscription = subscriptions?.[0] ?? null

  const { data: payments, error: paymentsError } = await auth.admin
    .from('subscription_payments')
    .select('id, subscription_id, influencer_id, payer_type, gateway, gateway_payment_id, payment_method, concept, amount, currency, status, paid_at, period_start, period_end, receipt_url')
    .eq('influencer_id', influencerId)
    .eq('payer_type', 'influencer')
    .order('paid_at', { ascending: false })

  if (paymentsError) return NextResponse.json({ error: 'No se pudo consultar el historial de pagos Pro.' }, { status: 500 })

  const completedPayments = (payments ?? []).filter(payment => payment.status === 'completed')
  const totalPaid = completedPayments.reduce((sum, payment) => sum + Number(payment.amount), 0)
  const latestPayment = completedPayments[0] ?? null

  return NextResponse.json({
    influencer,
    subscription: latestSubscription,
    summary: {
      status: latestSubscription?.status ?? null,
      started_paying_at: latestSubscription?.started_paying_at ?? latestPayment?.paid_at ?? null,
      next_billing_at: latestSubscription?.current_period_end ?? null,
      current_amount: latestPayment ? { amount: latestPayment.amount, currency: latestPayment.currency } : null,
      total_paid: totalPaid,
      total_paid_currency: latestPayment?.currency ?? null,
    },
    payments: payments ?? [],
  })
}
