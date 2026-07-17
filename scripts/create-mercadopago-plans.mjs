const token = process.env.MERCADOPAGO_ACCESS_TOKEN
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'

if (!token) {
  throw new Error('Falta MERCADOPAGO_ACCESS_TOKEN')
}

const plans = [
  ['BASIC', 'SCENCE Plan Basic', 67000],
  ['GROWTH', 'SCENCE Plan Growth', 497000],
  ['PRO', 'SCENCE Plan Pro', 697000],
]

for (const [key, reason, amount] of plans) {
  const response = await fetch('https://api.mercadopago.com/preapproval_plan', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      reason,
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: amount,
        currency_id: 'CLP',
      },
      back_url: `${appUrl}/brand-settings/plan`,
    }),
  })

  const result = await response.json()
  if (!response.ok) {
    console.error(`${key}:`, result)
    process.exitCode = 1
    continue
  }

  console.log(`MERCADOPAGO_${key}_PLAN_ID=${result.id}`)
}
