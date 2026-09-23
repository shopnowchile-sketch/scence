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

  // PayPal's standard Subscriptions API cancels immediately through /cancel.
  // To preserve the already-paid monthly period, we instead cap the current
  // billing cycle count at the cycle that is already in progress.
  const detailsResponse = await fetch(
    `${influencerPayPalBaseUrl()}/v1/billing/subscriptions/${encodeURIComponent(paypalSubscriptionId)}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    },
  )
  const details = await detailsResponse.json().catch(() => null)
  if (!detailsResponse.ok) {
    throw new Error(details?.message ?? 'PayPal no pudo consultar la suscripción.')
  }

  const cycles = Array.isArray(details?.plan?.billing_cycles) ? details.plan.billing_cycles as Array<Record<string, unknown>> : []
  const regularIndex = cycles.findIndex(cycle => cycle.tenure_type === 'REGULAR')
  if (regularIndex < 0) throw new Error('PayPal no devolvió el ciclo mensual regular de la suscripción.')

  const regularCycle = cycles[regularIndex]
  const completed = Number(regularCycle.cycles_completed ?? 0)
  if (!Number.isFinite(completed)) throw new Error('PayPal devolvió un ciclo de facturación inválido.')

  const patchResponse = await fetch(
    `${influencerPayPalBaseUrl()}/v1/billing/subscriptions/${encodeURIComponent(paypalSubscriptionId)}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        {
          op: 'replace',
          path: `/plan/billing_cycles/${regularIndex}/total_cycles`,
          value: completed + 1,
        },
      ]),
    },
  )

  if (!patchResponse.ok && patchResponse.status !== 204) {
    const detail = await patchResponse.json().catch(() => null)
    throw new Error(detail?.message ?? 'PayPal no pudo programar el fin del período actual.')
  }
}
