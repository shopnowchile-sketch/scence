import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { hasBrandPermission, resolveBrandAccess } from '@/lib/supabase/ensureOrg'
import { type PlanTier } from '@/lib/plan-limits'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'
const VALID_TIERS: PlanTier[] = ['basic', 'growth', 'pro']

export async function POST(req: NextRequest) {
  const isPreview = process.env.VERCEL_ENV === 'preview'
  // Suscripciones se prueba entre usuarios test con el APP_USR de pruebas de
  // la aplicación. No corresponde usar una credencial TEST- ni X-scope: stage.
  const token = isPreview && process.env.MERCADOPAGO_TEST_ACCESS_TOKEN
    ? process.env.MERCADOPAGO_TEST_ACCESS_TOKEN
    : process.env.MERCADOPAGO_ACCESS_TOKEN

  if (!token) {
    return NextResponse.json(
      { error: 'Los pagos con Mercado Pago todavía no están habilitados. Inténtalo nuevamente más tarde.' },
      { status: 503 },
    )
  }

  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!user.email) return NextResponse.json({ error: 'Tu cuenta no tiene un email válido para iniciar el pago.' }, { status: 422 })

  // El pagador es el email REAL del usuario test Comprador generado en Mercado
  // Pago; nunca el email de la marca real que inició sesión.
  const configuredTestPayer = process.env.MERCADOPAGO_TEST_PAYER_EMAIL
  if (isPreview && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(configuredTestPayer ?? '')) {
    return NextResponse.json(
      { error: 'Falta configurar el email del comprador de prueba de Mercado Pago en Preview.' },
      { status: 503 },
    )
  }
  const payerEmail = isPreview ? configuredTestPayer! : user.email

  const access = await resolveBrandAccess(user.id)
  if (!access) return NextResponse.json({ error: 'No organization found' }, { status: 404 })
  if (!hasBrandPermission(access, 'billing.manage')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: { tier?: PlanTier }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const tier = body.tier
  if (!tier || !VALID_TIERS.includes(tier)) return NextResponse.json({ error: 'Plan inválido' }, { status: 422 })

  const admin = createAdminClient()
  const { data: planRow, error: planError } = await admin.from('subscription_plans').select('id, tier, name, price_monthly').eq('tier', tier).eq('is_active', true).maybeSingle()
  if (planError || !planRow) return NextResponse.json({ error: 'El plan seleccionado no está configurado en SCENCE.' }, { status: 500 })

  const monthlyAmount = Number(planRow.price_monthly)
  if (!Number.isFinite(monthlyAmount) || monthlyAmount <= 0) return NextResponse.json({ error: 'El precio del plan seleccionado no está configurado correctamente.' }, { status: 500 })

  const externalReference = `${access.organizationId}:${planRow.id}:${tier}`
  // En Preview usamos su propio dominio para que el webhook también use las
  // credenciales de pruebas. En Production conserva el dominio público de SCENCE.
  const appUrl = isPreview ? req.nextUrl.origin : APP_URL
  const notificationUrl = `${appUrl}/api/mercadopago/webhook`

  const mpResponse = await fetch('https://api.mercadopago.com/preapproval', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': `${access.organizationId}-${tier}-${Date.now()}`,
    },
    body: JSON.stringify({
      reason: `Suscripción mensual SCENCE ${planRow.name}`,
      external_reference: externalReference,
      payer_email: payerEmail,
      status: 'authorized',
      auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: monthlyAmount, currency_id: 'CLP' },
      back_url: `${appUrl}/brand-settings/plan?checkout=processing`,
      notification_url: notificationUrl,
    }),
  })

  const result = await mpResponse.json()
  if (!mpResponse.ok) {
    console.error('[mercadopago/checkout]', result)
    if (mpResponse.status === 401) {
      const identityResponse = await fetch('https://api.mercadopago.com/users/me', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      const error = identityResponse.ok
        ? 'El token es válido, pero esta aplicación no tiene autorización para crear Suscripciones. Revisa que sea la misma aplicación de Mercado Pago que tiene habilitado el producto Suscripciones.'
        : 'El Access Token de este entorno no es válido. En Preview usa el APP_USR de pruebas de la aplicación y en Producción el APP_USR de producción.'
      return NextResponse.json({ error }, { status: 502 })
    }
    return NextResponse.json({ error: result?.message ?? 'No se pudo iniciar la suscripción en Mercado Pago.' }, { status: 502 })
  }

  const checkoutUrl = result.init_point ?? result.sandbox_init_point
  if (!checkoutUrl) return NextResponse.json({ error: 'Mercado Pago no devolvió una URL de pago.' }, { status: 502 })
  return NextResponse.json({ url: checkoutUrl, subscription_id: result.id })
}
