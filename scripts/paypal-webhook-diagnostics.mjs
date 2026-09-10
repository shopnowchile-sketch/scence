#!/usr/bin/env node
/**
 * Diagnóstico de webhooks de PayPal — SOLO LECTURA, no escribe nada.
 *
 * Responde sin necesitar el servidor levantado ni sesión de super admin
 * (a diferencia de /api/admin/paypal-diagnostics, que exige cookie de admin):
 *   1. cuántos webhooks hay registrados en la cuenta PayPal;
 *   2. qué eventos tiene suscrito cada uno;
 *   3. cuál webhook id usa la app según el archivo de entorno leído;
 *   4. si la firma va a validar (el id configurado existe y apunta a la ruta real);
 *   5. si PAYMENT.SALE.COMPLETED / PAYMENT.SALE.REFUNDED están configurados.
 *
 * Uso:
 *   node scripts/paypal-webhook-diagnostics.mjs                      # usa .env.local
 *   node scripts/paypal-webhook-diagnostics.mjs .env.production.local
 *
 * OJO: el listado de webhooks es de la CUENTA PayPal (igual en local y prod),
 * pero "qué id usa la app" depende del entorno. Para la respuesta de
 * producción hay que correrlo con las variables de Vercel:
 *   vercel env pull .env.production.local
 * No imprime ningún secreto.
 */
import { readFileSync } from 'node:fs'

const envFile = process.argv[2] ?? '.env.local'
const env = {}
for (const line of readFileSync(envFile, 'utf8').split('\n')) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (match) env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '')
}

const base = env.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'
const configuredId = env.PAYPAL_WEBHOOK_ID ?? env.PAYPAL_INFLUENCER_WEBHOOK_ID ?? null

console.log(`Archivo de entorno : ${envFile}`)
console.log(`PAYPAL_ENV         : ${env.PAYPAL_ENV ?? '(no definido)'} → ${base}`)
console.log(`PAYPAL_WEBHOOK_ID            definido: ${Boolean(env.PAYPAL_WEBHOOK_ID)}`)
console.log(`PAYPAL_INFLUENCER_WEBHOOK_ID definido: ${Boolean(env.PAYPAL_INFLUENCER_WEBHOOK_ID)}`)
console.log(`Webhook id que usaría la app: ${configuredId ?? '(ninguno → la ruta responde 503 a todo evento)'}\n`)

if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
  console.error('Faltan PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET en el archivo de entorno.')
  process.exit(1)
}

const authorization = Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString('base64')
const tokenResponse = await fetch(`${base}/v1/oauth2/token`, {
  method: 'POST',
  headers: { Authorization: `Basic ${authorization}`, 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'grant_type=client_credentials',
})
const tokenBody = await tokenResponse.json()
if (!tokenResponse.ok) {
  console.error(`No se pudo autenticar contra PayPal: ${tokenBody.error_description ?? tokenResponse.status}`)
  process.exit(1)
}

const response = await fetch(`${base}/v1/notifications/webhooks`, {
  headers: { Authorization: `Bearer ${tokenBody.access_token}` },
})
const body = await response.json()
if (!response.ok) {
  console.error(`PayPal respondió ${response.status}: ${body.message ?? ''}`)
  process.exit(1)
}

const webhooks = body.webhooks ?? []
console.log(`Webhooks registrados en la cuenta: ${webhooks.length}\n`)

for (const hook of webhooks) {
  const events = (hook.event_types ?? []).map((e) => e.name)
  const has = (name) => events.includes(name) || events.includes('*')
  console.log(`── ${hook.id}`)
  console.log(`   url                        : ${hook.url}`)
  console.log(`   apunta a /api/paypal/webhook: ${String(hook.url ?? '').endsWith('/api/paypal/webhook')}`)
  console.log(`   ES EL QUE USA LA APP        : ${hook.id === configuredId}`)
  console.log(`   BILLING.SUBSCRIPTION.ACTIVATED: ${has('BILLING.SUBSCRIPTION.ACTIVATED')}`)
  console.log(`   PAYMENT.SALE.COMPLETED     : ${has('PAYMENT.SALE.COMPLETED')}   ← lo que necesita el ledger`)
  console.log(`   PAYMENT.SALE.REFUNDED      : ${has('PAYMENT.SALE.REFUNDED')}`)
  console.log(`   eventos (${events.length}): ${events.join(', ')}\n`)
}

const matched = webhooks.find((h) => h.id === configuredId)
console.log('─── VEREDICTO ───')
if (!configuredId) console.log('✗ No hay webhook id configurado: la ruta responde 503 a TODO evento.')
else if (!matched) console.log('✗ El id configurado no corresponde a ningún webhook de esta cuenta: la firma falla y todo evento se descarta con 401.')
else if (!String(matched.url ?? '').endsWith('/api/paypal/webhook')) console.log('✗ El id configurado apunta a una URL que la app no expone: los eventos del webhook correcto se rechazan por firma inválida.')
else console.log('✓ La firma valida contra el webhook que apunta a la ruta real.')

if (webhooks.length > 1) {
  console.log(`⚠ Hay ${webhooks.length} webhooks registrados y la app valida contra UNO solo: los eventos que lleguen por los otros se descartan con 401.`)
}
