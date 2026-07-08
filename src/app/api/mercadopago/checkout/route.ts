import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'
import { PLAN_LIMITS, type PlanTier } from '@/lib/plan-limits'
import { Preference, MercadoPagoConfig } from 'mercadopago'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'

const VALID_TIERS: PlanTier[] = ['basic', 'growth', 'pro']

export async function POST(req: NextRequest) {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN

  if (!token) {
    return NextResponse.json(
      {
        error: 'Mercado Pago aún está pendiente de activación. Solicita tu plan y lo activamos manualmente con la oferta de lanzamiento.',
        manual: true,
      },
      { status: 503 }
    )
  }

  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)

  if (!orgId) {
    return NextResponse.json({ error: 'No organization found' }, { status: 404 })
  }

  let body: { tier?: PlanTier }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const tier = body.tier

  if (!tier || !VALID_TIERS.includes(tier)) {
    return NextResponse.json({ error: 'Plan inválido' }, { status: 422 })
  }

  const plan = PLAN_LIMITS[tier]
  const secondMonthAmount = Math.round(plan.price_monthly_clp * 0.5)

  const client = new MercadoPagoConfig({ accessToken: token })
  const preference = new Preference(client)

  const result = await preference.create({
    body: {
      external_reference: `${orgId}:${tier}`,
      items: [
        {
          id: `scence-${tier}-activation`,
          title: `SCENCE ${plan.label} — activación 3 meses`,
          description: `Mes 1 gratis, mes 2 con 50% de descuento, mes 3 a precio normal. Suscripción mínima 3 meses.`,
          quantity: 1,
          currency_id: 'CLP',
          unit_price: secondMonthAmount + plan.price_monthly_clp,
        },
      ],
      back_urls: {
        success: `${APP_URL}/brand-settings/plan?checkout=success`,
        failure: `${APP_URL}/brand-settings/plan?checkout=failure`,
        pending: `${APP_URL}/brand-settings/plan?checkout=pending`,
      },
      auto_return: 'approved',
      metadata: {
        organization_id: orgId,
        tier,
        plan_label: plan.label,
        monthly_price_clp: plan.price_monthly_clp,
        launch_offer: 'month_1_free_month_2_50_percent_month_3_regular',
        minimum_months: 3,
      },
    },
  })

  return NextResponse.json({
    url: result.init_point ?? result.sandbox_init_point,
  })
}
