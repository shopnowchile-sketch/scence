import { INFLUENCER_PRO_PRICING } from '@/lib/influencer-pro-pricing'

export const influencerPayPalBaseUrl = () => process.env.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'

export async function getInfluencerPayPalToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID, clientSecret = process.env.PAYPAL_CLIENT_SECRET
  if (!clientId || !clientSecret) return null
  const authorization = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const response = await fetch(`${influencerPayPalBaseUrl()}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${authorization}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials', cache: 'no-store' })
  const result = await response.json().catch(() => null)
  return response.ok ? result?.access_token as string | undefined : null
}

type PayPalBillingCycle = {
  tenure_type?: string
  sequence?: number
  total_cycles?: number
  frequency?: { interval_unit?: string; interval_count?: number }
  pricing_scheme?: { fixed_price?: { value?: string; currency_code?: string } }
}

export async function getInfluencerPayPalPlanPricing() {
  const planId = process.env.PAYPAL_INFLUENCER_PRO_PLAN_ID
  if (!planId) return null
  const accessToken = await getInfluencerPayPalToken()
  if (!accessToken) return null
  const response = await fetch(`${influencerPayPalBaseUrl()}/v1/billing/plans/${encodeURIComponent(planId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  })
  const plan = await response.json().catch(() => null) as { status?: string; billing_cycles?: PayPalBillingCycle[] } | null
  if (!response.ok || !plan) return null
  const cycles = plan.billing_cycles ?? []
  const promo = cycles.find(cycle => cycle.tenure_type === 'TRIAL')
  const regular = cycles.find(cycle => cycle.tenure_type === 'REGULAR')
  const promoPrice = promo?.pricing_scheme?.fixed_price
  const regularPrice = regular?.pricing_scheme?.fixed_price
  const structureValid = plan.status === 'ACTIVE'
    && promo?.frequency?.interval_unit === 'MONTH'
    && (promo.frequency.interval_count ?? 1) === 1
    && promo.total_cycles === INFLUENCER_PRO_PRICING.promoCycles
    && regular?.frequency?.interval_unit === 'MONTH'
    && (regular.frequency.interval_count ?? 1) === 1
    && regular.total_cycles === 0
    && !!promoPrice?.value
    && !!regularPrice?.value
    && promoPrice.currency_code === regularPrice.currency_code
    && promoPrice.currency_code === INFLUENCER_PRO_PRICING.currency
    && promoPrice.value === INFLUENCER_PRO_PRICING.promoAmount
    && regularPrice.value === INFLUENCER_PRO_PRICING.regularAmount
  return {
    plan_id: planId,
    currency: promoPrice?.currency_code ?? null,
    promo_amount: promoPrice?.value ?? null,
    promo_cycles: promo?.total_cycles ?? null,
    regular_amount: regularPrice?.value ?? null,
    structure_valid: structureValid,
  }
}

export function parseInfluencerReference(customId: unknown) {
  const [kind, influencerId, campaignId] = String(customId ?? '').split(':')
  return kind === 'influencer' && influencerId ? { influencerId, campaignId: campaignId || null } : null
}
