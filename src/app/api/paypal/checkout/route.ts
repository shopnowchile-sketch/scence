import { NextRequest, NextResponse } from 'next/server'
import { payPalBaseUrl } from '@/lib/paypal-env'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { canPayBrandPlan, resolveAgencyManagedBrandAccess, resolveBrandAccess } from '@/lib/supabase/ensureOrg'
import { type PlanTier } from '@/lib/plan-limits'
import { AGENCY_COMMITMENT_MONTHS, AGENCY_PLAN_PRICE_CLP, brandHasCurrentSubscription } from '@/lib/agency-brands'

// 'agency' = mensualidad por marca de una agencia (Impulso Consulting): una suscripción por marca.
type CheckoutTier = PlanTier | 'agency'
const VALID_TIERS: CheckoutTier[] = ['basic', 'growth', 'pro', 'agency']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function paypalBaseUrl() { return payPalBaseUrl() }

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

function planIdFor(tier: CheckoutTier) {
  return ({ basic: process.env.PAYPAL_BASIC_PLAN_ID, growth: process.env.PAYPAL_GROWTH_PLAN_ID, pro: process.env.PAYPAL_PRO_PLAN_ID, agency: process.env.PAYPAL_AGENCY_PLAN_ID } as Record<CheckoutTier, string | undefined>)[tier]
}

// Acceso a la marca que paga. Mensualidad ('agency'): la marca viene del cuerpo y vale si la agencia del usuario
// la administra; si no, solo la marca de su propia sesión (y si indica otra, no coincide → null). Los demás
// planes siguen usando la marca de la sesión.
async function resolvePayerAccess(userId: string, tier: CheckoutTier, brandId?: string) {
  if (tier !== 'agency') return resolveBrandAccess(userId)
  const managed = brandId ? await resolveAgencyManagedBrandAccess(userId, brandId) : null
  if (managed) return managed
  const own = await resolveBrandAccess(userId)
  return own && (!brandId || own.brandId === brandId) ? own : null
}

// GET /api/paypal/checkout?tier=agency&brand_id=… — monto EXACTO en USD que PayPal cobrará (leído del plan en PayPal).
export async function GET(request: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const brandId = request.nextUrl.searchParams.get('brand_id') ?? undefined
  const access = await resolvePayerAccess(user.id, 'agency', brandId && UUID.test(brandId) ? brandId : undefined)
  if (!access || !canPayBrandPlan(access)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const paypalPlanId = planIdFor('agency')
  if (!paypalPlanId) return NextResponse.json({ error: 'PayPal todavía no está habilitado para este plan.' }, { status: 503 })
  try {
    const token = await getAccessToken()
    const response = await fetch(`${paypalBaseUrl()}/v1/billing/plans/${encodeURIComponent(paypalPlanId)}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
    const plan = await response.json()
    const cycle = (plan?.billing_cycles ?? []).find((c: { pricing_scheme?: { fixed_price?: { value?: string } } }) => c.pricing_scheme?.fixed_price?.value)
    const amount = cycle?.pricing_scheme?.fixed_price
    if (!response.ok || !amount?.value) return NextResponse.json({ error: 'No se pudo leer el monto del plan en PayPal.' }, { status: 502 })
    return NextResponse.json({
      brand_id: access.brandId,
      amount_usd: amount.value, currency: amount.currency_code ?? 'USD',
      price_clp: AGENCY_PLAN_PRICE_CLP, commitment_months: AGENCY_COMMITMENT_MONTHS,
      already_current: await brandHasCurrentSubscription(createAdminClient(), access.brandId),
    })
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo conectar con PayPal.' }, { status: 502 }) }
}

export async function POST(request: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: { tier?: CheckoutTier; brand_id?: string; campaign_id?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const tier = body.tier
  if (!tier || !VALID_TIERS.includes(tier)) return NextResponse.json({ error: 'Plan invÃ¡lido' }, { status: 422 })
  if (body.brand_id !== undefined && (typeof body.brand_id !== 'string' || !UUID.test(body.brand_id))) return NextResponse.json({ error: 'Marca inválida' }, { status: 422 })
  const access = await resolvePayerAccess(user.id, tier, body.brand_id)
  if (!access) return NextResponse.json({ error: 'No organization found' }, { status: 404 })
  // Pagar el plan sigue siendo exclusivo del owner; vale para marcas pendientes (eligen plan) y suspendidas (reactivan).
  if (!canPayBrandPlan(access)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const paypalPlanId = planIdFor(tier)
  if (!paypalPlanId) return NextResponse.json({ error: 'PayPal todavÃ­a no estÃ¡ habilitado para este plan.' }, { status: 503 })
  const admin = createAdminClient()
  // Plan de agencia: una mensualidad vigente ya paga ese período (no se cobra dos veces) y un alta reciente
  // sin completar se reutiliza en vez de abrir otra suscripción en PayPal.
  if (tier === 'agency' && await brandHasCurrentSubscription(admin, access.brandId)) {
    return NextResponse.json({ error: 'Esta marca ya tiene su mensualidad vigente.', code: 'ALREADY_ACTIVE' }, { status: 409 })
  }
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
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': tier === 'agency' ? `scence-agency-${access.brandId}-${Math.floor(Date.now() / 3_600_000)}` : `scence-${access.organizationId}-${tier}-${Date.now()}` },
      body: JSON.stringify({ plan_id: paypalPlanId, custom_id: tier === 'agency' ? `${access.organizationId}:${planRow.id}:agency:${access.brandId}` : `${access.organizationId}:${planRow.id}:${tier}`, application_context: { brand_name: 'SCENCE', user_action: 'SUBSCRIBE_NOW', return_url: `${appUrl}/brand-settings/plan?checkout=processing&provider=paypal${tier === 'agency' ? `&brand=${access.brandId}${body.campaign_id && UUID.test(body.campaign_id) ? `&campaign=${body.campaign_id}` : ''}` : ''}`, cancel_url: `${appUrl}/brand-settings/plan?checkout=cancelled&provider=paypal` } }),
    })
    const result = await response.json()
    if (!response.ok) return NextResponse.json({ error: result?.message ?? 'No se pudo iniciar la suscripciÃ³n con PayPal.' }, { status: 502 })
    const url = result.links?.find((link: { rel?: string; href?: string }) => link.rel === 'approve')?.href
    if (!url) return NextResponse.json({ error: 'PayPal no devolviÃ³ una URL de aprobaciÃ³n.' }, { status: 502 })
    // Plan de agencia: la suscripción queda registrada desde ya, atada a su marca, como `incomplete`.
    // Solo el backend, tras leer ACTIVE en PayPal (complete / webhook), la vuelve `active`.
    if (tier === 'agency') {
      const { data: known } = await admin.from('subscriptions').select('id').eq('paypal_subscription_id', result.id).maybeSingle()
      if (!known) {
        const { error: insertError } = await admin.from('subscriptions').insert({
          organization_id: access.organizationId, plan_id: planRow.id, status: 'incomplete', paypal_subscription_id: result.id,
          metadata: { account_type: 'brand', brand_id: access.brandId, agency_plan: true, commitment_months: AGENCY_COMMITMENT_MONTHS },
          updated_at: new Date().toISOString(),
        })
        if (insertError) return NextResponse.json({ error: 'No se pudo registrar la suscripción de la marca.' }, { status: 500 })
      }
    }
    return NextResponse.json({ url, subscription_id: result.id })
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo conectar con PayPal.' }, { status: 502 }) }
}
