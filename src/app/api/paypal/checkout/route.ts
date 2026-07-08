import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'
import { PLAN_LIMITS, type PlanTier } from '@/lib/plan-limits'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'

const VALID_TIERS: PlanTier[] = ['basic', 'growth', 'pro']

const PAYPAL_USD_PRICE: Record<PlanTier, number> = {
  basic: 79,
  growth: 279,
  pro: 749,
}

function paypalBaseUrl() {
  return process.env.PAYPAL_ENV === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com'
}

async function getPayPalAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error('PayPal no está configurado')
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  const res = await fetch(`${paypalBaseUrl()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })

  const json = await res.json()

  if (!res.ok) {
    console.error('[PayPal OAuth]', json)
    throw new Error('No se pudo autenticar con PayPal')
  }

  return json.access_token as string
}

export async function POST(req: NextRequest) {
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
  const monthlyUsd = PAYPAL_USD_PRICE[tier]
  const firstPaymentUsd = monthlyUsd * 1.5

  const accessToken = await getPayPalAccessToken()

  const res = await fetch(`${paypalBaseUrl()}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': `scence-${orgId}-${tier}-${Date.now()}`,
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: `${orgId}:${tier}`,
          description: `SCENCE ${plan.label} — activación mínima 3 meses`,
          amount: {
            currency_code: 'USD',
            value: firstPaymentUsd.toFixed(2),
          },
          custom_id: `${orgId}:${tier}`,
        },
      ],
      application_context: {
        brand_name: 'SCENCE',
        landing_page: 'LOGIN',
        user_action: 'PAY_NOW',
        return_url: `${APP_URL}/brand-settings/plan?paypal=success&tier=${tier}`,
        cancel_url: `${APP_URL}/brand-settings/plan?paypal=cancel&tier=${tier}`,
      },
    }),
  })

  const json = await res.json()

  if (!res.ok) {
    console.error('[PayPal order]', json)
    return NextResponse.json({ error: 'No se pudo crear el checkout de PayPal' }, { status: 500 })
  }

  const approveUrl = json.links?.find((l: { rel: string; href: string }) => l.rel === 'approve')?.href

  if (!approveUrl) {
    return NextResponse.json({ error: 'PayPal no devolvió URL de aprobación' }, { status: 500 })
  }

  return NextResponse.json({ url: approveUrl })
}
