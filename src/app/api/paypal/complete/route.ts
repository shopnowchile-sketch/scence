import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { resolveBrandAccess } from '@/lib/supabase/ensureOrg'
import { getResend, FROM_EMAIL } from '@/lib/resend'

function baseUrl() { return process.env.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com' }
const ADMIN_PAYMENT_EMAIL = process.env.PAYPAL_ADMIN_NOTIFICATION_EMAIL ?? 'hola.scence@gmail.com'

export async function POST(request: NextRequest) {
  const subscriptionId = request.nextUrl.searchParams.get('subscription_id')
  if (!subscriptionId) return NextResponse.json({ error: 'Falta la suscripción de PayPal.' }, { status: 422 })
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const access = await resolveBrandAccess(user.id)
  if (!access) return NextResponse.json({ error: 'No organization found' }, { status: 404 })
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
  const admin = createAdminClient()
  const { data: activeSubscriptions } = await admin
    .from('subscriptions')
    .select('id, paypal_subscription_id')
    .eq('organization_id', access.organizationId)
    .in('status', ['active', 'trialing'])
  const activeRows = activeSubscriptions ?? []
  const current = activeRows.find((row) => row.paypal_subscription_id === subscriptionId) ?? null
  const previous = activeRows.find((row) => row.paypal_subscription_id && row.paypal_subscription_id !== subscriptionId) ?? null
  const { error } = await admin.from('organizations').update({ subscription_plan: tier }).eq('id', access.organizationId)
  if (error) return NextResponse.json({ error: 'No se pudo actualizar el plan.' }, { status: 500 })
  const subscriptionRow = { organization_id: access.organizationId, plan_id: planId, status: 'active', current_period_start: subscription.start_time ?? subscription.create_time, current_period_end: subscription.billing_info?.next_billing_time ?? subscription.start_time ?? subscription.create_time, paypal_subscription_id: subscriptionId, paypal_payer_id: subscription.subscriber?.payer_id ?? null, updated_at: new Date().toISOString() }
  if (!current) {
    const result = previous || activeRows.length === 0
      ? await admin.from('subscriptions').insert(subscriptionRow)
      : await admin.from('subscriptions').update(subscriptionRow).eq('organization_id', access.organizationId).in('status', ['active', 'trialing'])
    if (result.error) return NextResponse.json({ error: 'No se pudo guardar la nueva suscripción.' }, { status: 500 })
  }
  // El pago confirmado activa la cuenta de una marca autorregistrada. Desde
  // este punto puede entrar al flujo de creación de su primera campaña.
  await admin.from('brands').update({ subscription_plan_override: tier, status: 'approved' }).eq('id', access.brandId)
  if (previous?.paypal_subscription_id) {
    const cancelResponse = await fetch(`${baseUrl()}/v1/billing/subscriptions/${encodeURIComponent(previous.paypal_subscription_id)}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Plan cambiado en SCENCE' }),
    })
    if (!cancelResponse.ok && cancelResponse.status !== 204) return NextResponse.json({ error: 'El nuevo plan está activo, pero no se pudo cancelar el anterior.' }, { status: 502 })
    await admin.from('subscriptions').update({ status: 'canceled', canceled_at: new Date().toISOString() }).eq('id', previous.id)
  }
  const pricing = { basic: ['Basic', '79.00', '106.65'], growth: ['Growth', '279.00', '376.65'], pro: ['Pro', '749.00', '1011.15'] } as const
  const [name, launch, regular] = pricing[tier as 'basic' | 'growth' | 'pro']
  if (user.email) {
    await getResend().emails.send({
      from: FROM_EMAIL,
      to: user.email,
      subject: `Confirmación de suscripción SCENCE · ${name}`,
      html: `<h2>Tu suscripción está activa</h2><p>Plan: <strong>${name}</strong></p><p>Precio de lanzamiento: <strong>US$${launch}/mes</strong> durante 3 meses.</p><p>Luego: <strong>US$${regular}/mes</strong>.</p><p>Tu acceso en SCENCE ya fue actualizado.</p>`,
    }).catch(() => null)
  }
  await getResend().emails.send({
    from: FROM_EMAIL,
    to: ADMIN_PAYMENT_EMAIL,
    subject: `Nuevo pago PayPal · ${name}`,
    html: `<h2>Nuevo pago confirmado</h2><p>Plan: <strong>${name}</strong></p><p>Cliente: <strong>${user.email ?? 'Sin email'}</strong></p><p>Organización: <strong>${access.organizationId}</strong></p><p>Suscripción PayPal: <strong>${subscriptionId}</strong></p><p>Precio de lanzamiento: <strong>US$${launch}/mes</strong> durante 3 meses. Luego US$${regular}/mes.</p>`,
  }).catch(() => null)
  return NextResponse.json({ tier })
}
