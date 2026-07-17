import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { resolveBrandAccess } from '@/lib/supabase/ensureOrg'
import { PLAN_LIMITS, type PlanTier } from '@/lib/plan-limits'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'
const VALID_TIERS: PlanTier[] = ['basic', 'growth', 'pro']

const PLAN_ID_ENV: Record<PlanTier, string> = {
  basic: 'MERCADOPAGO_BASIC_PLAN_ID',
  growth: 'MERCADOPAGO_GROWTH_PLAN_ID',
  pro: 'MERCADOPAGO_PRO_PLAN_ID',
}
const DB_TIER: Record<PlanTier, string> = { basic: 'starter', growth: 'growth', pro: 'pro' }

export async function POST(req: NextRequest) {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN

  if (!token) {
    return NextResponse.json(
      { error: 'Mercado Pago no está configurado todavía.', manual: true },
      { status: 503 },
    )
  }

  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!user.email) {
    return NextResponse.json({ error: 'Tu cuenta no tiene un email válido para iniciar el pago.' }, { status: 422 })
  }

  const access = await resolveBrandAccess(user.id)
  if (!access) {
    return NextResponse.json({ error: 'No organization found' }, { status: 404 })
  }

  if (!access.isOwner && access.role !== 'brand_manager') {
    return NextResponse.json({ error: 'Solo el owner o administrador de la marca puede contratar un plan.' }, { status: 403 })
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


  const mercadoPagoPlanId = process.env[PLAN_ID_ENV[tier]]
  if (!mercadoPagoPlanId) {
    return NextResponse.json(
      { error: `El plan ${PLAN_LIMITS[tier].label} todavía no está configurado en Mercado Pago.` },
      { status: 503 },
    )
  }

  const admin = createAdminClient()
  const { data: planRow, error: planError } = await admin
    .from('subscription_plans')
    .select('id, tier')
    .eq('tier', DB_TIER[tier])
    .eq('is_active', true)
    .maybeSingle()

  if (planError || !planRow) {
    return NextResponse.json({ error: 'El plan seleccionado no está configurado en SCENCE.' }, { status: 500 })
  }


  const { data: activeSubscription } = await admin
    .from('subscriptions')
    .select('id, plan_id, mercadopago_subscription_id')
    .eq('organization_id', access.organizationId)
    .in('status', ['active', 'trialing'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (activeSubscription) {
    return NextResponse.json(
      { error: 'Esta marca ya tiene una suscripción activa. Contáctanos para cambiar de plan.' },
      { status: 409 },
    )
  }

  const { data: pendingSubscription } = await admin
    .from('subscriptions')
    .select('id, plan_id, mercadopago_subscription_id, metadata')
    .eq('organization_id', access.organizationId)
    .eq('status', 'paused')
    .not('mercadopago_subscription_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (pendingSubscription) {
    const metadata = pendingSubscription.metadata as { checkout_url?: string; checkout_pending?: boolean } | null
    if (metadata?.checkout_pending && metadata.checkout_url) {
      if (pendingSubscription.plan_id !== planRow.id) {
        return NextResponse.json(
          { error: 'Ya existe un pago pendiente para otro plan. Complétalo o contáctanos para cambiarlo.' },
          { status: 409 },
        )
      }
      return NextResponse.json({
        url: metadata.checkout_url,
        subscription_id: pendingSubscription.mercadopago_subscription_id,
      })
    }
  }

  const plan = PLAN_LIMITS[tier]
  const externalReference = `${access.organizationId}:${planRow.id}:${tier}`

  const mpResponse = await fetch('https://api.mercadopago.com/preapproval', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': `${access.organizationId}-${tier}-${Date.now()}`,
    },
    body: JSON.stringify({
      preapproval_plan_id: mercadoPagoPlanId,
      reason: `SCENCE Plan ${plan.label}`,
      external_reference: externalReference,
      payer_email: user.email,
      back_url: `${APP_URL}/brand-settings/plan?checkout=success`,
      status: 'pending',
    }),
  })

  const result = await mpResponse.json()

  if (!mpResponse.ok) {
    console.error('[mercadopago/checkout]', result)
    return NextResponse.json(
      { error: result?.message ?? 'No se pudo iniciar la suscripción en Mercado Pago.' },
      { status: 502 },
    )
  }

  const checkoutUrl = result.init_point ?? result.sandbox_init_point
  if (!checkoutUrl) {
    return NextResponse.json({ error: 'Mercado Pago no devolvió una URL de pago.' }, { status: 502 })
  }


  const now = new Date()
  const nextMonth = new Date(now)
  nextMonth.setMonth(nextMonth.getMonth() + 1)

  const { error: pendingError } = await admin.from('subscriptions').insert({
    organization_id: access.organizationId,
    plan_id: planRow.id,
    status: 'paused',
    current_period_start: now.toISOString(),
    current_period_end: nextMonth.toISOString(),
    mercadopago_subscription_id: result.id,
    metadata: { provider: 'mercadopago', checkout_pending: true, checkout_url: checkoutUrl },
  })

  if (pendingError) {
    console.error('[mercadopago/checkout] no se pudo registrar checkout pendiente', pendingError.message)
    return NextResponse.json({ error: 'No se pudo registrar el inicio de la suscripción.' }, { status: 500 })
  }

  return NextResponse.json({ url: checkoutUrl, subscription_id: result.id })
}
