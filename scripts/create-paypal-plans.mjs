// Destino de PayPal: Sandbox y dry-run por defecto (ver scripts/lib/paypal-target.mjs).
import { resolvePayPalTarget } from './lib/paypal-target.mjs'
const target = resolvePayPalTarget({ argv: process.argv.slice(2), env: { PAYPAL_ENV: process.env.PAYPAL_ENV }, processEnv: process.env })
const env = target.mode
const baseUrl = target.base
for (const note of target.notes) console.warn(note)
console.log(`Destino PayPal: ${env} (${baseUrl}) · ${target.dryRun ? 'DRY-RUN (use --apply para crear)' : 'APPLY'}`)
const clientId = process.env.PAYPAL_CLIENT_ID, clientSecret = process.env.PAYPAL_CLIENT_SECRET
if (!clientId || !clientSecret) throw new Error('Define PAYPAL_CLIENT_ID y PAYPAL_CLIENT_SECRET antes de ejecutar este script.')
const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
const tokenResponse = await fetch(`${baseUrl}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' })
const tokenResult = await tokenResponse.json()
if (!tokenResponse.ok) throw new Error(`PayPal OAuth: ${tokenResult.error_description ?? tokenResult.error ?? tokenResponse.status}`)
if (target.dryRun) {
  console.log('DRY-RUN: no se creó ningún producto ni plan. Se crearían: SCENCE Basic, Growth, Pro (planes mensuales con trial de 3 ciclos).')
  process.exit(0)
}
let productId = process.env.PAYPAL_PRODUCT_ID
if (!productId) {
  const response = await fetch(`${baseUrl}/v1/catalogs/products`, { method: 'POST', headers: { Authorization: `Bearer ${tokenResult.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'SCENCE', description: 'Suscripción mensual a la plataforma SCENCE', type: 'SERVICE', category: 'SOFTWARE' }) })
  const product = await response.json(); if (!response.ok) throw new Error(`No se pudo crear producto: ${product.message ?? response.status}`); productId = product.id
}
const plans = [['BASIC', 'Basic', '79.00', '106.65'], ['GROWTH', 'Growth', '279.00', '376.65'], ['PRO', 'Pro', '749.00', '1011.15']]
console.log(`PAYPAL_PRODUCT_ID=${productId}`)
for (const [key, name, launchValue, regularValue] of plans) {
  const response = await fetch(`${baseUrl}/v1/billing/plans`, { method: 'POST', headers: { Authorization: `Bearer ${tokenResult.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ product_id: productId, name: `SCENCE ${name}`, description: `Plan mensual SCENCE ${name}`, billing_cycles: [{ frequency: { interval_unit: 'MONTH', interval_count: 1 }, tenure_type: 'TRIAL', sequence: 1, total_cycles: 3, pricing_scheme: { fixed_price: { currency_code: 'USD', value: launchValue } } }, { frequency: { interval_unit: 'MONTH', interval_count: 1 }, tenure_type: 'REGULAR', sequence: 2, total_cycles: 0, pricing_scheme: { fixed_price: { currency_code: 'USD', value: regularValue } } }], payment_preferences: { auto_bill_outstanding: true, setup_fee_failure_action: 'CANCEL', payment_failure_threshold: 1 } }) })
  const plan = await response.json(); if (!response.ok) throw new Error(`No se pudo crear ${name}: ${plan.message ?? response.status}`); console.log(`PAYPAL_${key}_PLAN_ID=${plan.id}`)
}
