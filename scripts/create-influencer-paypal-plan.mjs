const baseUrl = process.env.PAYPAL_ENV?.replaceAll('"', '') === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'
const clientId = process.env.PAYPAL_CLIENT_ID, clientSecret = process.env.PAYPAL_CLIENT_SECRET
if (!clientId || !clientSecret) throw new Error('Faltan credenciales PayPal.')
const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
const tokenResponse = await fetch(`${baseUrl}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' })
const token = await tokenResponse.json()
if (!tokenResponse.ok) throw new Error(token.error_description ?? 'No se pudo autenticar en PayPal.')
const headers = { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' }
const productResponse = await fetch(`${baseUrl}/v1/catalogs/products`, { method: 'POST', headers, body: JSON.stringify({ name: 'SCENCE Influencer Pro', description: 'Suscripción mensual Plan Pro para Influencers de SCENCE', type: 'SERVICE', category: 'SOFTWARE' }) })
const product = await productResponse.json()
if (!productResponse.ok) throw new Error(`Producto PayPal: ${product.message ?? productResponse.status}`)
const planResponse = await fetch(`${baseUrl}/v1/billing/plans`, { method: 'POST', headers, body: JSON.stringify({ product_id: product.id, name: 'SCENCE Influencer Pro Mensual', description: 'Plan Pro para Influencers — $7.990 CLP al mes', billing_cycles: [{ frequency: { interval_unit: 'MONTH', interval_count: 1 }, tenure_type: 'REGULAR', sequence: 1, total_cycles: 0, pricing_scheme: { fixed_price: { currency_code: 'CLP', value: '7990' } } }], payment_preferences: { auto_bill_outstanding: true, setup_fee_failure_action: 'CANCEL', payment_failure_threshold: 1 } }) })
const plan = await planResponse.json()
if (!planResponse.ok) throw new Error(`Plan PayPal: ${plan.message ?? plan.details?.[0]?.description ?? planResponse.status}`)
console.log(`PAYPAL_INFLUENCER_PRO_PLAN_ID=${plan.id}`)
