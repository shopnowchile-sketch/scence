const baseUrl = 'https://api-m.paypal.com'

const clientId = process.env.PAYPAL_CLIENT_ID
const clientSecret = process.env.PAYPAL_CLIENT_SECRET

if (!clientId || !clientSecret) {
  throw new Error('Faltan PAYPAL_CLIENT_ID o PAYPAL_CLIENT_SECRET')
}

const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

const tokenResponse = await fetch(`${baseUrl}/v1/oauth2/token`, {
  method: 'POST',
  headers: {
    Authorization: `Basic ${auth}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  },
  body: 'grant_type=client_credentials',
})

const token = await tokenResponse.json()

if (!tokenResponse.ok) {
  throw new Error(`PayPal OAuth: ${JSON.stringify(token)}`)
}

const headers = {
  Authorization: `Bearer ${token.access_token}`,
  'Content-Type': 'application/json',
}

const productResponse = await fetch(`${baseUrl}/v1/catalogs/products`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    name: 'SCENCE Influencer Pro',
    description: 'Suscripción mensual Plan Pro para Influencers de SCENCE',
    type: 'SERVICE',
    category: 'SOFTWARE',
  }),
})

const product = await productResponse.json()

if (!productResponse.ok) {
  throw new Error(`Producto PayPal: ${JSON.stringify(product)}`)
}

const planResponse = await fetch(`${baseUrl}/v1/billing/plans`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    product_id: product.id,
    name: 'SCENCE Influencer Pro',
    description: 'US$8.60/mes durante 3 meses. Luego US$16.13/mes.',
    billing_cycles: [
      {
        frequency: {
          interval_unit: 'MONTH',
          interval_count: 1,
        },
        tenure_type: 'TRIAL',
        sequence: 1,
        total_cycles: 3,
        pricing_scheme: {
          fixed_price: {
            currency_code: 'USD',
            value: '8.60',
          },
        },
      },
      {
        frequency: {
          interval_unit: 'MONTH',
          interval_count: 1,
        },
        tenure_type: 'REGULAR',
        sequence: 2,
        total_cycles: 0,
        pricing_scheme: {
          fixed_price: {
            currency_code: 'USD',
            value: '16.13',
          },
        },
      },
    ],
    payment_preferences: {
      auto_bill_outstanding: true,
      setup_fee_failure_action: 'CANCEL',
      payment_failure_threshold: 1,
    },
  }),
})

const plan = await planResponse.json()

if (!planResponse.ok) {
  throw new Error(`Plan PayPal: ${JSON.stringify(plan)}`)
}

console.log('')
console.log('PLAN CREADO CORRECTAMENTE')
console.log(`PAYPAL_INFLUENCER_PRO_PLAN_ID=${plan.id}`)
console.log('')
console.log(JSON.stringify({
  id: plan.id,
  status: plan.status,
  name: plan.name,
  billing_cycles: plan.billing_cycles,
}, null, 2))
