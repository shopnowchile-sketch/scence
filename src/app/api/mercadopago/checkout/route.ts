import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { resolveBrandAccess } from '@/lib/supabase/ensureOrg'
import { PLAN_LIMITS, type PlanTier } from '@/lib/plan-limits'

const PRODUCTION_APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'
const VALID_TIERS: PlanTier[] = ['basic', 'growth', 'pro']
const DB_TIER: Record<PlanTier, string> = { basic: 'starter', growth: 'growth', pro: 'pro' }

export async function POST(req: NextRequest) {
  const isPreview = process.env.VERCEL_ENV === 'preview'
  const token = isPreview
    ? process.env.MERCADOPAGO_TEST_ACCESS_TOKEN ?? process.env.MERCADOPAGO_ACCESS_TOKEN
    : process.env.MERCADOPAGO_ACCESS_TOKEN

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

  const payerEmail = (
    isPreview ? process.env.MERCADOPAGO_TEST_PAYER_EMAIL : user.email
  )?.trim()

  if (!payerEmail) {
    return NextResponse.json(
      { error: 'Falta configurar el comprador de prueba de Mercado Pago.' },
      { status: 503 },
    )
  }

  if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(payerEmail)) {
    return NextResponse.json(
      { error: 'El email del comprador de Mercado Pago no es válido.' },
      { status: 503 },
    )
  }
  const access = await resolveBrandAccess(user.id)
  if (!access) {
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

  const plan = PLAN_LIMITS[tier]
  const externalReference = `${access.organizationId}:${planRow.id}:${tier}`
  const appUrl = isPreview ? req.nextUrl.origin : PRODUCTION_APP_URL

  const mpResponse = await fetch('https://api.mercadopago.com/preapproval', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': `${access.organizationId}-${tier}-${Date.now()}`,
    },
    body: JSON.stringify({
      reason: `Suscripción mensual SCENCE ${plan.label}`,
      external_reference: externalReference,
      payer_email: payerEmail,
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: plan.price_monthly_clp,
        currency_id: 'CLP',
      },
      back_url: `${appUrl}/brand-settings/plan?checkout=success`,
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

  return NextResponse.json({ url: checkoutUrl, subscription_id: result.id })
}
