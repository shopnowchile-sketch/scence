export const influencerPayPalBaseUrl = () => process.env.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'

export async function getInfluencerPayPalToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID, clientSecret = process.env.PAYPAL_CLIENT_SECRET
  if (!clientId || !clientSecret) return null
  const authorization = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const response = await fetch(`${influencerPayPalBaseUrl()}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${authorization}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials', cache: 'no-store' })
  const result = await response.json().catch(() => null)
  return response.ok ? result?.access_token as string | undefined : null
}

export function parseInfluencerReference(customId: unknown) {
  const [kind, influencerId, campaignId] = String(customId ?? '').split(':')
  return kind === 'influencer' && influencerId ? { influencerId, campaignId: campaignId || null } : null
}


export async function scheduleInfluencerPayPalCancellation(paypalSubscriptionId: string) {
  const accessToken = await getInfluencerPayPalToken()
  if (!accessToken) throw new Error('PayPal no está configurado.')

  const response = await fetch(
    `${influencerPayPalBaseUrl()}/v1/billing/subscriptions/${encodeURIComponent(paypalSubscriptionId)}/cancel`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cancel_option: 'END_OF_PERIOD' }),
    },
  )

  if (!response.ok && response.status !== 204) {
    const detail = await response.json().catch(() => null)
    throw new Error(detail?.message ?? 'PayPal no pudo programar la cancelación al final del período.')
  }
}
