import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'
import { getStripe } from '@/lib/stripe'

// POST /api/stripe/checkout — crea una Stripe Checkout session para el plan
// elegido (body: { plan_id }). Antes estaba hardcodeado a un único plan
// "pro" (PLANS.pro.priceId) — ahora es plan-aware, lee subscription_plans.
export async function POST(request: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return NextResponse.json({ error: 'No organization found' }, { status: 404 })

  const body = await request.json().catch(() => ({}))
  const planId: string | undefined = body.plan_id
  if (!planId) return NextResponse.json({ error: 'plan_id requerido' }, { status: 422 })

  const { data: plan } = await admin
    .from('subscription_plans')
    .select('id, name, stripe_price_id_monthly')
    .eq('id', planId)
    .eq('is_active', true)
    .maybeSingle()

  if (!plan) return NextResponse.json({ error: 'Plan no encontrado' }, { status: 404 })
  if (!plan.stripe_price_id_monthly) {
    return NextResponse.json({
      error: `El plan "${plan.name}" todavía no tiene un Stripe Price ID configurado (subscription_plans.stripe_price_id_monthly)`,
    }, { status: 422 })
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

  const successUrl = body.success_url ?? `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'}/brand-billing?upgraded=1`
  const cancelUrl  = body.cancel_url  ?? `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'}/brand-billing`

  const session = await getStripe().checkout.sessions.create({
    customer:   customerId,
    mode:       'subscription',
    line_items: [{ price: plan.stripe_price_id_monthly, quantity: 1 }],
    success_url: successUrl,
    cancel_url:  cancelUrl,
    metadata: { organization_id: orgId, plan_id: plan.id },
    subscription_data: {
      metadata: { organization_id: orgId, plan_id: plan.id },
    },
    allow_promotion_codes: true,
  })

  return NextResponse.json({ url: session.url })
}
