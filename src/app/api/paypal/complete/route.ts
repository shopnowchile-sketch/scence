import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { hasBrandPermission, resolveBrandAccess } from '@/lib/supabase/ensureOrg'
import { getResend, FROM_EMAIL } from '@/lib/resend'
import { emailAudience } from '@/lib/inactive-influencer-email-guard'
import { BRAND_PLAN_USD_PRICING, PLAN_LIMITS, isInfluencerSubscription, type PlanTier } from '@/lib/plan-limits'

function baseUrl() { return process.env.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com' }
const ADMIN_PAYMENT_EMAIL = process.env.ADMIN_NOTIFICATION_EMAIL ?? 'hola.scence@gmail.com'

export async function POST(request: NextRequest) {
  const subscriptionId = request.nextUrl.searchParams.get('subscription_id')
  if (!subscriptionId) return NextResponse.json({ error: 'Falta la suscripción de PayPal.' }, { status: 422 })
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const access = await resolveBrandAccess(user.id)
  if (!access) return NextResponse.json({ error: 'No organization found' }, { status: 404 })
  if (!hasBrandPermission(access, 'billing.manage')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const clientId = process.env.PAYPAL_CLIENT_ID, secret = process.env.PAYPAL_CLIENT_SECRET
  if (!clientId || !secret) return NextResponse.json({ error: 'PayPal no está configurado.' }, { status: 503 })
  const authorization = Buffer.from(`${clientId}:${secret}`).toString('base64')
  const tokenResponse = await fetch(`${baseUrl()}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${authorization}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials', cache: 'no-store' })
  const token = await tokenResponse.json()
  if (!tokenResponse.ok || !token.access_token) return NextResponse.json({ error: 'No se pudo validar PayPal.' }, { status: 502 })
  const detailsResponse = await fetch(`${baseUrl()}/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`, { headers: { Authorization: `Bearer ${token.access_token}` }, cache: 'no-store' })
  const subscription = await detailsResponse.json()
  const [organizationId, planId, tier] = String(subscription.custom_id ?? '').split(':')
  if (!detailsResponse.ok || organizationId !== access.organizationId || !['basic', 'growth', 'pro'].includes(tier) || subscription.status !== 'ACTIVE') return NextResponse.json({ error: 'La suscripción aún no está activa.' }, { status: 409 })
  // La suscripción debe ser del plan de PayPal de ese tier (no otro plan con un custom_id alterado).
  const expectedPayPalPlan = ({ basic: process.env.PAYPAL_BASIC_PLAN_ID, growth: process.env.PAYPAL_GROWTH_PLAN_ID, pro: process.env.PAYPAL_PRO_PLAN_ID } as Record<string, string | undefined>)[tier]
  if (!expectedPayPalPlan || subscription.plan_id !== expectedPayPalPlan) return NextResponse.json({ error: 'La suscripción no corresponde al plan elegido.' }, { status: 409 })
  const admin = createAdminClient()
  const { data: planRow, error: planError } = await admin.from('subscription_plans').select('id, tier').eq('id', planId).maybeSingle()
  if (planError) return NextResponse.json({ error: 'No se pudo validar el plan.' }, { status: 500 })
  if (!planRow || planRow.tier !== (tier === 'basic' ? 'starter' : tier)) return NextResponse.json({ error: 'La suscripción no corresponde al plan elegido.' }, { status: 409 })

  // Fila de SCENCE para ESTA suscripción de PayPal (cualquier estado). Si ya
  // existe y pertenece a otra organización o a una influencer, no se toca.
  const { data: existingRow, error: existingError } = await admin
    .from('subscriptions')
    .select('id, organization_id, metadata')
    .eq('paypal_subscription_id', subscriptionId)
    .maybeSingle()
  if (existingError) return NextResponse.json({ error: 'No se pudo validar la suscripción.' }, { status: 500 })
  if (existingRow && (existingRow.organization_id !== access.organizationId || isInfluencerSubscription(existingRow.metadata))) {
    return NextResponse.json({ error: 'La suscripción no corresponde a esta marca.' }, { status: 409 })
  }

  const subscriptionRow = {
    organization_id: access.organizationId,
    plan_id: planId,
    status: 'active',
    current_period_start: subscription.start_time ?? subscription.create_time,
    current_period_end: subscription.billing_info?.next_billing_time ?? subscription.start_time ?? subscription.create_time,
    paypal_subscription_id: subscriptionId,
    paypal_payer_id: subscription.subscriber?.payer_id ?? null,
    metadata: { ...((existingRow?.metadata as Record<string, unknown> | null) ?? {}), account_type: 'brand', brand_id: access.brandId },
    updated_at: new Date().toISOString(),
  }
  const saved = existingRow
    ? await admin.from('subscriptions').update(subscriptionRow).eq('id', existingRow.id)
    : await admin.from('subscriptions').insert(subscriptionRow)
  if (saved.error) return NextResponse.json({ error: 'No se pudo guardar la nueva suscripción.' }, { status: 500 })

  // El pago confirmado aprueba a una marca autorregistrada. El ACCESO pagado
  // se deriva de la suscripción activa (resolveBrandPlanAccess); el override
  // queda reservado a planes otorgados manualmente por un admin.
  const { error: brandError } = await admin.from('brands').update({ status: 'approved' }).eq('id', access.brandId)
  if (brandError) return NextResponse.json({ error: 'El pago está registrado, pero no se pudo activar la marca.' }, { status: 500 })

  // Cambio de plan: otra suscripción de MARCA activa en la misma organización
  // se cancela en PayPal. Nunca una suscripción de influencer.
  const { data: activeRows, error: activeError } = await admin
    .from('subscriptions')
    .select('id, paypal_subscription_id, metadata')
    .eq('organization_id', access.organizationId)
    .in('status', ['active', 'trialing'])
  if (activeError) return NextResponse.json({ error: 'El nuevo plan está activo, pero no se pudo revisar el anterior.' }, { status: 500 })
  const previousRows = (activeRows ?? []).filter(row =>
    !isInfluencerSubscription(row.metadata) && row.paypal_subscription_id && row.paypal_subscription_id !== subscriptionId)
  for (const previous of previousRows) {
    const cancelResponse = await fetch(`${baseUrl()}/v1/billing/subscriptions/${encodeURIComponent(previous.paypal_subscription_id as string)}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Plan cambiado en SCENCE' }),
    })
    if (!cancelResponse.ok && cancelResponse.status !== 204) return NextResponse.json({ error: 'El nuevo plan está activo, pero no se pudo cancelar el anterior.' }, { status: 502 })
    const { error: cancelError } = await admin.from('subscriptions').update({ status: 'canceled', canceled_at: new Date().toISOString() }).eq('id', previous.id)
    if (cancelError) return NextResponse.json({ error: 'El plan anterior se canceló en PayPal, pero no se pudo registrar.' }, { status: 500 })
  }
  const planTier = tier as PlanTier
  const name = PLAN_LIMITS[planTier].label
  const launch = BRAND_PLAN_USD_PRICING[planTier].launch.toFixed(2)
  const regular = BRAND_PLAN_USD_PRICING[planTier].regular.toFixed(2)
  if (user.email) {
    await getResend().emails.send({
      from: FROM_EMAIL,
      to: user.email, tags: [emailAudience('brand')],
      subject: `Confirmación de suscripción SCENCE · ${name}`,
      html: `<h2>Tu suscripción está activa</h2><p>Plan: <strong>${name}</strong></p><p>Precio de lanzamiento: <strong>US$${launch}/mes</strong> durante 3 meses.</p><p>Luego: <strong>US$${regular}/mes</strong>.</p><p>Tu acceso en SCENCE ya fue actualizado.</p>`,
    }).catch(() => null)
  }
  await getResend().emails.send({
    from: FROM_EMAIL,
    to: ADMIN_PAYMENT_EMAIL, tags: [emailAudience('admin')],
    subject: `Nuevo pago PayPal · ${name}`,
    html: `<h2>Nuevo pago confirmado</h2><p>Plan: <strong>${name}</strong></p><p>Cliente: <strong>${user.email ?? 'Sin email'}</strong></p><p>Organización: <strong>${access.organizationId}</strong></p><p>Suscripción PayPal: <strong>${subscriptionId}</strong></p><p>Precio de lanzamiento: <strong>US$${launch}/mes</strong> durante 3 meses. Luego US$${regular}/mes.</p>`,
  }).catch(() => null)
  return NextResponse.json({ tier })
}
