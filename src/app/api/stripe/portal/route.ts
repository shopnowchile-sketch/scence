import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { hasBrandPermission, resolveBrandAccess } from '@/lib/supabase/ensureOrg'
import { getStripe } from '@/lib/stripe'

// POST /api/stripe/portal — redirect to Stripe Customer Portal (manage/cancel sub)
export async function POST(request: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const access = await resolveBrandAccess(user.id)
  if (!access) return NextResponse.json({ error: 'No organization found' }, { status: 404 })
  if (!hasBrandPermission(access, 'billing.manage')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const orgId = access.organizationId

  const { data: org } = await admin
    .from('organizations')
    .select('stripe_customer_id')
    .eq('id', orgId)
    .single()

  const customerId = (org as Record<string, unknown>)?.stripe_customer_id as string | undefined
  if (!customerId) {
    return NextResponse.json({ error: 'No Stripe customer found — upgrade first' }, { status: 404 })
  }

  const body = await request.json().catch(() => ({}))
  const returnUrl = body.return_url ?? `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'}/brand-billing`

  const session = await getStripe().billingPortal.sessions.create({
    customer:   customerId,
    return_url: returnUrl,
  })

  return NextResponse.json({ url: session.url })
}
