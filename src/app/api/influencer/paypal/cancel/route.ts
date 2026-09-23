import { NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { hasActiveCampaignCommitment } from '@/lib/influencer-pro-commitment'
import { cancelInfluencerPayPalAtPeriodEnd, isInfluencerProCancellationScheduled, persistInfluencerProCancellation } from '@/lib/influencer-paypal'

const BLOCKED_MESSAGE = 'Tu suscripción Pro está vinculada a una campaña. Podrás cancelarla cuando la campaña haya terminado y hayas completado todos tus entregables.'
const PENDING_MESSAGE = 'Tu campaña ya terminó, pero aún tienes entregables pendientes. Completa todos tus entregables para poder cancelar tu suscripción.'

function formatDate(iso: string | null | undefined) {
  if (!iso) return null
  return new Intl.DateTimeFormat('es-CL', { dateStyle: 'long', timeZone: 'America/Santiago' }).format(new Date(iso))
}

export async function POST() {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const { data: influencer } = await admin.from('influencers').select('id').eq('user_id', user.id).maybeSingle()
  if (!influencer) return NextResponse.json({ error: 'Not an influencer account' }, { status: 403 })

  // Última suscripción Pro PayPal de la influencer, en cualquier estado: así una
  // segunda solicitud se detecta como "ya programada" en vez de caer en 404.
  const { data: subscriptions, error: subscriptionError } = await admin.from('subscriptions')
    .select('id, status, current_period_end, paypal_subscription_id, metadata, subscription_plans!inner(tier)')
    .not('paypal_subscription_id', 'is', null)
    // Se excluyen checkouts abandonados ('incomplete') para que no oculten la suscripción vigente.
    .in('status', ['active', 'trialing', 'canceled'])
    .eq('metadata->>influencer_id', influencer.id).eq('subscription_plans.tier', 'pro')
    .order('created_at', { ascending: false }).limit(1)
  if (subscriptionError) return NextResponse.json({ error: 'No se pudo consultar tu suscripción.' }, { status: 500 })
  const subscription = subscriptions?.[0]

  if (subscription && isInfluencerProCancellationScheduled(subscription)) {
    const until = formatDate(subscription.current_period_end)
    return NextResponse.json({
      error: until ? `Tu cancelación ya está programada. Tu Plan Pro seguirá activo hasta el ${until} y no se renovará.` : 'Tu cancelación ya está programada.',
      code: 'CANCELLATION_ALREADY_SCHEDULED',
      paid_through: subscription.current_period_end,
    }, { status: 409 })
  }
  if (!subscription?.paypal_subscription_id || !['active', 'trialing'].includes(subscription.status)) {
    return NextResponse.json({ error: 'No tienes una suscripción Pro activa.' }, { status: 404 })
  }

  try {
    const commitment = await hasActiveCampaignCommitment(admin, influencer.id, subscription.metadata)
    if (commitment.blocked) return NextResponse.json({ error: commitment.reason === 'deliverables_pending' ? PENDING_MESSAGE : BLOCKED_MESSAGE, campaign: commitment.commitment }, { status: 409 })
  } catch (error) {
    console.error('[POST /api/influencer/paypal/cancel] commitment check:', error)
    return NextResponse.json({ error: 'No se pudo validar el compromiso de campaña.' }, { status: 500 })
  }

  let paidThrough: string
  try {
    ({ paidThrough } = await cancelInfluencerPayPalAtPeriodEnd(subscription.paypal_subscription_id))
  } catch (error) {
    console.error('[POST /api/influencer/paypal/cancel] PayPal cancellation:', error)
    return NextResponse.json({ error: 'No se pudo cancelar la renovación en PayPal. No se realizó ningún cambio.' }, { status: 502 })
  }

  const { error: updateError, periodEnd } = await persistInfluencerProCancellation(admin, subscription, paidThrough, 'influencer_requested')
  if (updateError) {
    console.error('[POST /api/influencer/paypal/cancel] persist cancellation:', updateError)
    return NextResponse.json({ error: 'PayPal canceló la renovación, pero no se pudo sincronizar SCENCE. Escríbenos para revisarlo.' }, { status: 500 })
  }
  return NextResponse.json({ canceled: true, cancel_at_period_end: true, paid_through: periodEnd })
}
