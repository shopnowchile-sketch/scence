import Stripe from 'stripe'

// Lazy — only instantiated at request time, never at build time
let _stripe: Stripe | null = null
export function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? 'sk_placeholder', {
      apiVersion: '2024-04-10',
      typescript: true,
    })
  }
  return _stripe
}

// ── Plan config ──────────────────────────────────────────────────────────────
export const PLANS = {
  free: {
    name: 'Free',
    priceId: null,
    limits: {
      campaigns:   5,
      influencers: 100,
      bookings:    20,   // per month
      invoices:    10,
    },
  },
  pro: {
    name: 'Pro',
    priceId: process.env.STRIPE_PRO_PRICE_ID,
    limits: {
      campaigns:   Infinity,
      influencers: Infinity,
      bookings:    Infinity,
      invoices:    Infinity,
    },
  },
} as const

export type PlanKey = keyof typeof PLANS

export function getPlanFromStatus(
  subscriptionStatus: string | null | undefined,
  subscriptionPlan: string | null | undefined
): PlanKey {
  if (!subscriptionStatus || subscriptionStatus === 'free') return 'free'
  if (subscriptionStatus === 'active' || subscriptionStatus === 'trialing') {
    return (subscriptionPlan as PlanKey) ?? 'pro'
  }
  return 'free'
}

// Stripe webhook event types we handle
export const HANDLED_WEBHOOK_EVENTS = [
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
  'checkout.session.completed',
] as const
