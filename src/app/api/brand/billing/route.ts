import { NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'
import { getActivePlans, getOrgSubscription } from '@/lib/subscription-plans'
import { resolveBrandPlan } from '@/lib/plan-limits'

// GET /api/brand/billing — planes activos + suscripción actual + plan efectivo de la org
export async function GET() {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return NextResponse.json({ error: 'No organization found' }, { status: 404 })

  const [plans, subscription, orgPlan] = await Promise.all([
    getActivePlans(admin),
    getOrgSubscription(admin, orgId),
    resolveBrandPlan(admin, orgId),
  ])

  return NextResponse.json({ plans, subscription, org_plan: orgPlan })
}
