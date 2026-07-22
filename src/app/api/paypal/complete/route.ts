import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { resolveBrandAccess } from '@/lib/supabase/ensureOrg'
import { getResend, FROM_EMAIL } from '@/lib/resend'

function baseUrl() { return process.env.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com' }

export async function POST(request: NextRequest) {
  const subscriptionId = request.nextUrl.searchParams.get('subscription_id')
  if (!subscriptionId) return NextResponse.json({ error: 'Falta la suscripciÃ³n de PayPal.' }, { status: 422 })
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const access = await resolveBrandAccess(user.id)
  if (!access) return NextResponse.json({ error: 'No organization found' }, { status: 404 })
  const clientId = process.env.PAYPAL_CLIENT_ID, secret = process.env.PAYPAL_CLIENT_SECRET
  if (!clientId || !secret) return NextResponse.json({ error: 'PayPal no estÃ¡ configurado.' }, { status: 503 })
  const authorization = Buffer.from(`${clientId}:${secret}`).toString('base64')
  const tokenResponse = await fetch(`${baseUrl()}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${authorization}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials', cache: 'no-store' })
  const token = await tokenResponse.json()
  if (!tokenResponse.ok || !token.access_token) return NextResponse.json({ error: 'No se pudo validar PayPal.' }, { status: 502 })
  const detailsResponse = await fetch(`${baseUrl()}/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`, { headers: { Authorization: `Bearer ${token.access_token}` }, cache: 'no-store' })
  const subscription = await detailsResponse.json()
  const [organizationId, planId, tier] = String(subscription.custom_id ?? '').split(':')
  if (!detailsResponse.ok || organizationId !== access.organizationId || !['basic', 'growth', 'pro'].includes(tier) || subscription.status !== 'ACTIVE') return NextResponse.json({ error: 'La suscripciÃ³n aÃºn no estÃ¡ activa.' }, { status: 409 })
  const admin = createAdminClient()
  const { error } = await admin.from('organizations').update({ subscription_plan: tier }).eq('id', access.organizationId)
  if (error) return NextResponse.json({ error: 'No se pudo actualizar el plan.' }, { status: 500 })
  await admin.from('subscriptions').update({ plan_id: planId }).eq('organization_id', access.organizationId).in('status', ['active', 'trialing'])
  await admin.from('brands').update({ subscription_plan_override: tier }).eq('id', access.brandId)
  const pricing = { basic: ['Basic', '79.00', '106.65'], growth: ['Growth', '279.00', '376.65'], pro: ['Pro', '749.00', '1011.15'] } as const
  const [name, launch, regular] = pricing[tier as 'basic' | 'growth' | 'pro']
  if (user.email) {
    await getResend().emails.send({
      from: FROM_EMAIL,
      to: user.email,
      subject: `ConfirmaciÃ³n de suscripciÃ³n SCENCE Â· ${name}`,
      html: `<h2>Tu suscripciÃ³n estÃ¡ activa</h2><p>Plan: <strong>${name}</strong></p><p>Precio de lanzamiento: <strong>US$${launch}/mes</strong> durante 3 meses.</p><p>Luego: <strong>US$${regular}/mes</strong>.</p><p>Tu acceso en SCENCE ya fue actualizado.</p>`,
    }).catch(() => null)
  }
  return NextResponse.json({ tier })
}
