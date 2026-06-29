import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'
import { getStripe, PLANS } from '@/lib/stripe'

// POST /api/stripe/checkout — create a Stripe Checkout session for Pro plan
export async function POST(request: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return NextResponse.json({ error: 'No organization found' }, { status: 404 })

  if (!PLANS.pro.priceId) {
    return NextResponse.json({ error: 'STRIPE_PRO_PRICE_ID not configured' }, { status: 500 })
  }

  // Get org to find/create Stripe customer
  const { data: org } = await admin
    .from('organizations')
    .select('name, billing_email, stripe_customer_id')
    .eq('id', orgId)
    .single()

  let customerId = (org as Record<string, unknown>)?.stripe_customer_id as string | undefined

  // Create Stripe customer if not exists
  if (!customerId) {
    const customer = await getStripe().customers.create({
      email: org?.billing_email ?? user.email ?? undefined,
      name:  org?.name ?? undefined,
      metadata: { organization_id: orgId, user_id: user.id },
    })
    customerId = customer.id

    // Persist customer ID to org
    await admin
      .from('organizations')
      .update({ stripe_customer_id: customerId })
      .eq('id', orgId)
  }

  const body = await request.json().catch(() => ({}))
  const successUrl = body.success_url ?? `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence.vercel.app'}/settings?upgraded=1`
  const cancelUrl  = body.cancel_url  ?? `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence.vercel.app'}/settings`

  const session = await getStripe().checkout.sessions.create({
    customer:   customerId,
    mode:       'subscription',
    line_items: [{ price: PLANS.pro.priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url:  cancelUrl,
    metadata: { organization_id: orgId },
    subscription_data: {
      metadata: { organization_id: orgId },
    },
    allow_promotion_codes: true,
  })

  return NextResponse.json({ url: session.url })
}
