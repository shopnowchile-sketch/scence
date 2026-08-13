import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { hasBrandPermission, resolveBrandAccess } from '@/lib/supabase/ensureOrg'
import { type PlanTier } from '@/lib/plan-limits'

const VALID_TIERS: PlanTier[] = ['basic', 'growth', 'pro']

function paypalBaseUrl() { return process.env.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com' }

async function getAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('PayPal no estÃ¡ configurado')
  const authorization = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const response = await fetch(`${paypalBaseUrl()}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${authorization}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials', cache: 'no-store' })
  const result = await response.json()
  if (!response.ok || !result.access_token) throw new Error('No se pudo autenticar con PayPal')
  return result.access_token as string
}

function planIdFor(tier: PlanTier) {
  return ({ basic: process.env.PAYPAL_BASIC_PLAN_ID, growth: process.env.PAYPAL_GROWTH_PLAN_ID, pro: process.env.PAYPAL_PRO_PLAN_ID } as Record<PlanTier, string | undefined>)[tier]
}

export async function POST(request: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: { tier?: PlanTier }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const tier = body.tier
  if (!tier || !VALID_TIERS.includes(tier)) return NextResponse.json({ error: 'Plan invÃ¡lido' }, { status: 422 })
  const access = await resolveBrandAccess(user.id)
  if (!access) return NextResponse.json({ error: 'No organization found' }, { status: 404 })
  if (!hasBrandPermission(access, 'billing.manage')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const paypalPlanId = planIdFor(tier)
  if (!paypalPlanId) return NextResponse.json({ error: 'PayPal todavÃ­a no estÃ¡ habilitado para este plan.' }, { status: 503 })
  const admin = createAdminClient()
  // En la base, el plan que la UI llama Basic se almacena como `starter`.
  // La columna es un enum, por lo que no se puede consultar `basic` allÃ­.
  const databaseTier = tier === 'basic' ? 'starter' : tier
  const { data: planRow, error: planError } = await admin
    .from('subscription_plans')
    .select('id')
    .eq('tier', databaseTier)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()
  if (planError || !planRow) return NextResponse.json({ error: 'El plan seleccionado no estÃ¡ configurado en SCENCE.' }, { status: 500 })
  try {
    const token = await getAccessToken()
    const appUrl = process.env.VERCEL_ENV === 'preview' ? request.nextUrl.origin : (process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin)
    const response = await fetch(`${paypalBaseUrl()}/v1/billing/subscriptions`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': `scence-${access.organizationId}-${tier}-${Date.now()}` },
      body: JSON.stringify({ plan_id: paypalPlanId, custom_id: `${access.organizationId}:${planRow.id}:${tier}`, application_context: { brand_name: 'SCENCE', user_action: 'SUBSCRIBE_NOW', return_url: `${appUrl}/brand-settings/plan?checkout=processing&provider=paypal`, cancel_url: `${appUrl}/brand-settings/plan?checkout=cancelled&provider=paypal` } }),
    })
    const result = await response.json()
    if (!response.ok) return NextResponse.json({ error: result?.message ?? 'No se pudo iniciar la suscripciÃ³n con PayPal.' }, { status: 502 })
    const url = result.links?.find((link: { rel?: string; href?: string }) => link.rel === 'approve')?.href
    if (!url) return NextResponse.json({ error: 'PayPal no devolviÃ³ una URL de aprobaciÃ³n.' }, { status: 502 })
    return NextResponse.json({ url, subscription_id: result.id })
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo conectar con PayPal.' }, { status: 502 }) }
}
