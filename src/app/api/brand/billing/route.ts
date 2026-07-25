import { NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { resolveBrandAccess } from '@/lib/supabase/ensureOrg'
import { getActivePlans, getOrgSubscription } from '@/lib/subscription-plans'
import { resolveBrandPlan } from '@/lib/plan-limits'

// GET /api/brand/billing — planes activos + suscripción actual + plan efectivo de la org
//
// FIX (2026-07-10, multiusuario por marca): antes resolvía la organización
// con getOrgId(), que cae a user_metadata.organization_id o a la fila más
// reciente de organization_members del usuario — para un miembro invitado de
// brand_members (ej. mateluna641, que tiene su PROPIA organización huérfana
// de otro flujo) esto devolvía el billing de una organización que no tiene
// nada que ver con la marca a la que fue invitado. resolveBrandAccess()
// resuelve siempre la organización de LA MARCA (owner o miembro activo),
// consistente con el resto del portal — ver spec Pri "Opción A".
export async function GET() {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const access = await resolveBrandAccess(user.id)
  if (!access) return NextResponse.json({ error: 'No organization found' }, { status: 404 })
  const orgId = access.organizationId

  const [plans, subscription, orgPlan, brand] = await Promise.all([
    getActivePlans(admin),
    getOrgSubscription(admin, orgId),
    resolveBrandPlan(admin, orgId, access.brandId),
    admin.from('brands').select('subscription_plan_override').eq('id', access.brandId).maybeSingle(),
  ])

  return NextResponse.json({
    plans,
    subscription,
    org_plan: orgPlan,
    has_active_subscription: Boolean(subscription) || Boolean(brand.data?.subscription_plan_override),
  })
}
