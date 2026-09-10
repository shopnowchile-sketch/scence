#!/usr/bin/env node
/**
 * Agrega PAYMENT.SALE.COMPLETED y PAYMENT.SALE.REFUNDED a UN webhook de PayPal.
 *
 * Garantías (por eso existe, en vez de hacerlo por la UI):
 *   · No toca la URL del webhook. Nunca.
 *   · No toca ningún otro webhook de la cuenta.
 *   · Conserva TODOS los eventos actuales y solo agrega los que falten.
 *   · Se niega a operar si el webhook no apunta a /api/paypal/webhook.
 *   · Dry-run por defecto: imprime el payload exacto y no envía nada.
 *
 * Uso:
 *   node scripts/paypal-add-payment-events.mjs                 # dry-run
 *   node scripts/paypal-add-payment-events.mjs --apply         # aplica
 *   node scripts/paypal-add-payment-events.mjs --apply --webhook-id=XXX --env-file=.env.local
 */
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const arg = (name, fallback) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback

const WEBHOOK_ID = arg('webhook-id', '6C043840J4937764N')
const ENV_FILE = arg('env-file', '.env.local')
const EXPECTED_PATH = '/api/paypal/webhook'
const TO_ADD = ['PAYMENT.SALE.COMPLETED', 'PAYMENT.SALE.REFUNDED']

const env = {}
for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (match) env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '')
}
const base = env.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'
if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
  console.error(`Faltan PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET en ${ENV_FILE}.`)
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
const authHeaders = { Authorization: `Bearer ${tokenBody.access_token}`, 'Content-Type': 'application/json' }

const currentResponse = await fetch(`${base}/v1/notifications/webhooks/${encodeURIComponent(WEBHOOK_ID)}`, { headers: authHeaders })
const current = await currentResponse.json()
if (!currentResponse.ok) {
  console.error(`No se pudo leer el webhook ${WEBHOOK_ID}: ${current.message ?? currentResponse.status}`)
  process.exit(1)
}

console.log(`Entorno   : ${env.PAYPAL_ENV} → ${base}`)
console.log(`Webhook   : ${current.id}`)
console.log(`URL       : ${current.url}   (NO se modifica)\n`)

// Guardarraíl: si no es el webhook que la app expone, no se toca.
if (!String(current.url ?? '').endsWith(EXPECTED_PATH)) {
  console.error(`✗ ABORTADO: este webhook apunta a una URL que no es ${EXPECTED_PATH}.`)
  console.error('  Es el webhook equivocado. No se modificó nada.')
  process.exit(1)
}

const existing = (current.event_types ?? []).map((e) => e.name)
const missing = TO_ADD.filter((name) => !existing.includes(name))

console.log(`Eventos actuales (${existing.length}):`)
for (const name of existing) console.log(`   · ${name}`)
console.log()

if (missing.length === 0) {
  console.log('✓ Los dos eventos ya están configurados. Nada que hacer.')
  process.exit(0)
}

const finalEvents = [...existing, ...missing]
console.log(`Se AGREGAN (${missing.length}): ${missing.join(', ')}`)
console.log(`Se CONSERVAN los ${existing.length} actuales. Total quedaría en ${finalEvents.length}.\n`)

const patch = [{ op: 'replace', path: '/event_types', value: finalEvents.map((name) => ({ name })) }]

if (!APPLY) {
  console.log('DRY-RUN — no se envió nada a PayPal. Payload que se enviaría:')
  console.log(JSON.stringify(patch, null, 2))
  console.log('\nRepetir con --apply para aplicarlo.')
  process.exit(0)
}

const patchResponse = await fetch(`${base}/v1/notifications/webhooks/${encodeURIComponent(WEBHOOK_ID)}`, {
  method: 'PATCH',
  headers: authHeaders,
  body: JSON.stringify(patch),
})
const patched = await patchResponse.json().catch(() => null)
if (!patchResponse.ok) {
  console.error(`✗ PayPal rechazó el cambio (${patchResponse.status}): ${patched?.message ?? ''}`)
  if (patched?.details) console.error(JSON.stringify(patched.details, null, 2))
  process.exit(1)
}

const result = (patched?.event_types ?? []).map((e) => e.name)
console.log('✓ Aplicado. Eventos del webhook ahora:')
for (const name of result) console.log(`   · ${name}`)
console.log(`\nURL sin cambios: ${patched?.url}`)
console.log(`PAYMENT.SALE.COMPLETED presente: ${result.includes('PAYMENT.SALE.COMPLETED')}`)
console.log(`PAYMENT.SALE.REFUNDED  presente: ${result.includes('PAYMENT.SALE.REFUNDED')}`)
