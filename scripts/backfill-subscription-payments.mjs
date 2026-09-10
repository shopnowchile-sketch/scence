#!/usr/bin/env node
/**
 * Backfill del ledger de pagos de suscripción (one-shot).
 *
 * Por qué existe: los webhooks solo escuchaban BILLING.SUBSCRIPTION.*, así que
 * ningún cobro ya ocurrido quedó registrado. Además `current_period_start` se
 * sobrescribe en cada renovación — para las suscripciones activas hoy todavía
 * coincide con el inicio real, pero después de la primera renovación deja de
 * hacerlo. Este script recupera el historial desde PayPal y, como respaldo,
 * fija `started_paying_at` con el período vigente.
 *
 * Uso:
 *   node scripts/backfill-subscription-payments.mjs            # dry-run
 *   node scripts/backfill-subscription-payments.mjs --apply    # escribe
 *
 * Lee .env.local (o --env-file=otro). Necesita ahí: NEXT_PUBLIC_SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY, PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_ENV.
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const APPLY = process.argv.includes('--apply')
const CURRENCIES = new Set(['USD', 'EUR', 'MXN', 'CLP', 'COP', 'ARS', 'BRL', 'GBP'])

// Mismo cargador de entorno que scripts/paypal-webhook-diagnostics.mjs y
// scripts/paypal-add-payment-events.mjs, para no depender de exports previos.
const ENV_FILE = process.argv.find((a) => a.startsWith('--env-file='))?.split('=')[1] ?? '.env.local'
const env = { ...process.env }
for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (match) env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '')
}

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !serviceKey) throw new Error(`Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en ${ENV_FILE}.`)
const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

const paypalBase = env.PAYPAL_ENV === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com'

async function paypalToken() {
  const id = env.PAYPAL_CLIENT_ID, secret = env.PAYPAL_CLIENT_SECRET
  if (!id || !secret) throw new Error(`Faltan credenciales de PayPal en ${ENV_FILE}.`)
  const authorization = Buffer.from(`${id}:${secret}`).toString('base64')
  const response = await fetch(`${paypalBase}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${authorization}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error_description ?? 'No se pudo autenticar en PayPal.')
  return result.access_token
}

async function transactionsFor(token, paypalSubscriptionId, since) {
  const start = new Date(since).toISOString()
  const end = new Date().toISOString()
  const url = `${paypalBase}/v1/billing/subscriptions/${encodeURIComponent(paypalSubscriptionId)}`
    + `/transactions?start_time=${encodeURIComponent(start)}&end_time=${encodeURIComponent(end)}`
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) {
    console.warn(`  ⚠ PayPal ${response.status} para ${paypalSubscriptionId}`)
    return []
  }
  const result = await response.json()
  return Array.isArray(result.transactions) ? result.transactions : []
}

const token = await paypalToken()

const { data: subscriptions, error } = await admin
  .from('subscriptions')
  .select('id, status, organization_id, created_at, current_period_start, current_period_end, paypal_subscription_id, metadata')
  .not('paypal_subscription_id', 'is', null)
  .order('created_at', { ascending: true })
if (error) throw new Error(`No se pudieron leer las suscripciones: ${error.message}`)

console.log(`${subscriptions.length} suscripciones con PayPal. Modo: ${APPLY ? 'APLICAR' : 'dry-run'}\n`)

const rows = []
const fallbacks = []

for (const subscription of subscriptions) {
  const influencerId = subscription.metadata?.influencer_id ?? null
  const transactions = await transactionsFor(token, subscription.paypal_subscription_id, subscription.created_at)
  const completed = transactions.filter((t) => String(t.status).toUpperCase() === 'COMPLETED')

  for (const transaction of completed) {
    const amount = Number(transaction.amount_with_breakdown?.gross_amount?.value)
    const currency = String(transaction.amount_with_breakdown?.gross_amount?.currency_code ?? '').toUpperCase()
    if (!transaction.id || !Number.isFinite(amount) || amount <= 0 || !CURRENCIES.has(currency)) {
      console.warn(`  ⚠ transacción descartada (${transaction.id ?? 'sin id'}) monto/moneda inválidos`)
      continue
    }
    rows.push({
      subscription_id: subscription.id,
      organization_id: subscription.organization_id,
      influencer_id: influencerId,
      payer_type: influencerId ? 'influencer' : 'brand',
      gateway: 'paypal',
      gateway_payment_id: transaction.id,
      payment_method: 'paypal',
      concept: influencerId ? 'Suscripción SCENCE Pro' : 'Suscripción SCENCE — plan de marca',
      amount,
      currency,
      status: 'completed',
      paid_at: transaction.time,
      metadata: { backfill: true, source: 'paypal_transactions' },
    })
  }

  // Respaldo: activa, sin transacciones recuperables y sin fecha de inicio.
  if (completed.length === 0 && subscription.status === 'active') {
    fallbacks.push({ id: subscription.id, started_paying_at: subscription.current_period_start })
  }
}

console.log(`\nPagos recuperados de PayPal: ${rows.length}`)
console.log(`Suscripciones activas que caen al respaldo current_period_start: ${fallbacks.length}`)

if (!APPLY) {
  console.log('\nDry-run: no se escribió nada. Repetir con --apply.')
  console.table(rows.map((r) => ({ sub: r.subscription_id.slice(0, 8), pago: r.gateway_payment_id, monto: `${r.amount} ${r.currency}`, fecha: r.paid_at })))
  process.exit(0)
}

if (rows.length > 0) {
  const { error: insertError } = await admin
    .from('subscription_payments')
    .upsert(rows, { onConflict: 'gateway,gateway_payment_id', ignoreDuplicates: true })
  if (insertError) throw new Error(`Insert del ledger falló: ${insertError.message}`)
  console.log(`✓ ${rows.length} pagos insertados (el trigger fijó started_paying_at)`)
}

for (const fallback of fallbacks) {
  const { error: updateError } = await admin
    .from('subscriptions')
    .update({ started_paying_at: fallback.started_paying_at })
    .eq('id', fallback.id)
    .is('started_paying_at', null)
  if (updateError) throw new Error(`Respaldo de started_paying_at falló en ${fallback.id}: ${updateError.message}`)
}
if (fallbacks.length > 0) console.log(`✓ ${fallbacks.length} suscripciones con started_paying_at por respaldo`)

console.log('\nListo.')
