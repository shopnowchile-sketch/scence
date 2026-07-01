import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getStripe } from '@/lib/stripe'
import type Stripe from 'stripe'

// App Router: request.text() already returns raw body — no config needed

// Upsert en subscriptions (multi-plan) — antes escribía campos hardcodeados
// de un solo plan "pro" en organizations.subscription_status/subscription_plan,
// que ningún otro código del proyecto llegó a leer nunca (confirmado por grep).
// Se unifica sobre subscription_plans/subscriptions, que ya existían desde
// la migración baseline pero nunca se usaron.
async function upsertSubscription(
  admin: ReturnType<typeof createAdminClient>,
  params: {
    organizationId: string
    planId: string | null
    status: string
    currentPeriodStart: string
    currentPeriodEnd: string
    stripeSubscriptionId: string
    stripeCustomerId: string | null
    canceledAt?: string | null
  }
) {
  if (!params.planId) {
    console.error('[webhook] upsertSubscription: sin plan_id en metadata, no se puede vincular a un plan')
    return
  }

  const { data: existing } = await admin
    .from('subscriptions')
    .select('id')
    .eq('stripe_subscription_id', params.stripeSubscriptionId)
    .maybeSingle()

  const row = {
    organization_id:       params.organizationId,
    plan_id:               params.planId,
    status:                params.status,
    current_period_start:  params.currentPeriodStart,
    current_period_end:    params.currentPeriodEnd,
    stripe_subscription_id: params.stripeSubscriptionId,
    stripe_customer_id:    params.stripeCustomerId,
    canceled_at:           params.canceledAt ?? null,
    updated_at:            new Date().toISOString(),
  }

  const { error } = existing
    ? await admin.from('subscriptions').update(row).eq('id', existing.id)
    : await admin.from('subscriptions').insert(row)

  if (error) console.error('[webhook] upsertSubscription error:', error.message)
}

export async function POST(request: NextRequest) {
  const payload   = await request.text()
  const signature = request.headers.get('stripe-signature')

  if (!signature || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Missing signature or webhook secret' }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = getStripe().webhooks.constructEvent(payload, signature, process.env.STRIPE_WEBHOOK_SECRET)
  } catch (err: unknown) {
    console.error('[webhook] signature verification failed:', (err as Error).message)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const admin = createAdminClient()

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      const orgId = session.metadata?.organization_id
      const planId = session.metadata?.plan_id ?? null
      if (!orgId || session.mode !== 'subscription') break

      const subId = session.subscription as string
      if (subId) {
        const sub = await getStripe().subscriptions.retrieve(subId)
        await upsertSubscription(admin, {
          organizationId:       orgId,
          planId:               planId ?? sub.metadata?.plan_id ?? null,
          status:               sub.status,
          currentPeriodStart:   new Date(sub.current_period_start * 1000).toISOString(),
          currentPeriodEnd:     new Date(sub.current_period_end * 1000).toISOString(),
          stripeSubscriptionId: sub.id,
          stripeCustomerId:     typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null,
        })
      }
      break
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription
      const orgId = sub.metadata?.organization_id
      if (!orgId) break

      await upsertSubscription(admin, {
        organizationId:       orgId,
        planId:               sub.metadata?.plan_id ?? null,
        status:               sub.status,
        currentPeriodStart:   new Date(sub.current_period_start * 1000).toISOString(),
        currentPeriodEnd:     new Date(sub.current_period_end * 1000).toISOString(),
        stripeSubscriptionId: sub.id,
        stripeCustomerId:     typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null,
      })
      break
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription
      const orgId = sub.metadata?.organization_id
      if (!orgId) break

      await upsertSubscription(admin, {
        organizationId:       orgId,
        planId:               sub.metadata?.plan_id ?? null,
        status:               'canceled',
        currentPeriodStart:   new Date(sub.current_period_start * 1000).toISOString(),
        currentPeriodEnd:     new Date(sub.current_period_end * 1000).toISOString(),
        stripeSubscriptionId: sub.id,
        stripeCustomerId:     typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null,
        canceledAt:           new Date().toISOString(),
      })
      break
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice
      const customerId = invoice.customer as string
      if (!customerId) break

      await admin
        .from('subscriptions')
        .update({ status: 'past_due', updated_at: new Date().toISOString() })
        .eq('stripe_customer_id', customerId)
      break
    }

    default:
      // Unhandled event type — ignore
      break
  }

  return NextResponse.json({ received: true })
}
