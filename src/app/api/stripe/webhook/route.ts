import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getStripe } from '@/lib/stripe'
import type Stripe from 'stripe'

// App Router: request.text() already returns raw body — no config needed

async function updateOrgSubscription(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  update: {
    subscription_status: string
    subscription_plan: string
    subscription_period_end: string | null
    stripe_subscription_id?: string
  }
) {
  const { error } = await admin
    .from('organizations')
    .update({ ...update, updated_at: new Date().toISOString() })
    .eq('id', orgId)

  if (error) console.error('[webhook] updateOrgSubscription error:', error.message)
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
      if (!orgId || session.mode !== 'subscription') break

      // Subscription ID available in session.subscription
      const subId = session.subscription as string
      if (subId) {
        const sub = await getStripe().subscriptions.retrieve(subId)
        await updateOrgSubscription(admin, orgId, {
          subscription_status:     sub.status,
          subscription_plan:       'pro',
          stripe_subscription_id:  sub.id,
          subscription_period_end: sub.current_period_end
            ? new Date(sub.current_period_end * 1000).toISOString()
            : null,
        })
      }
      break
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription
      const orgId = sub.metadata?.organization_id
      if (!orgId) break

      await updateOrgSubscription(admin, orgId, {
        subscription_status:     sub.status,
        subscription_plan:       'pro',
        stripe_subscription_id:  sub.id,
        subscription_period_end: sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null,
      })
      break
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription
      const orgId = sub.metadata?.organization_id
      if (!orgId) break

      await updateOrgSubscription(admin, orgId, {
        subscription_status:     'canceled',
        subscription_plan:       'free',
        subscription_period_end: null,
      })
      break
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice
      const customerId = invoice.customer as string
      if (!customerId) break

      const { data: orgs } = await admin
        .from('organizations')
        .select('id')
        .eq('stripe_customer_id', customerId)
        .limit(1)

      const orgId = orgs?.[0]?.id
      if (orgId) {
        await admin
          .from('organizations')
          .update({ subscription_status: 'past_due', updated_at: new Date().toISOString() })
          .eq('id', orgId)
      }
      break
    }

    default:
      // Unhandled event type — ignore
      break
  }

  return NextResponse.json({ received: true })
}
