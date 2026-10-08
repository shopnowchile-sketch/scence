// Incidente Influencer Pro (2026-10-08, Tiare Valdebenito): pagó Pro el 29-09,
// un borrado masivo de admin eliminó su ficha el 04-10 y la suscripción quedó
// huérfana → al volver a entrar aparecía Free. Estos tests fijan las reglas de
// negocio de la suscripción Pro para que no se repita.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  buildInfluencerSubscriptionRow,
  influencerSubscriptionGrantsPro,
  selectOrphanSubscriptionsToRelink,
  payPalPaidThrough,
  type PayPalSubscriptionSnapshot,
  type StoredInfluencerSubscription,
} from '../src/lib/influencer-paypal.ts'

const NOW = new Date('2026-10-08T12:00:00Z')
const influencer = { id: 'inf-1', organization_id: 'org-1' }

function sync(details: PayPalSubscriptionSnapshot, existing: StoredInfluencerSubscription | null = null) {
  return buildInfluencerSubscriptionRow({ details, paypalSubscriptionId: 'I-TEST', existing, influencer, planId: 'plan-pro', campaignId: null, now: NOW })
}
const asStored = (row: ReturnType<typeof sync>, id = 'sub-1'): StoredInfluencerSubscription => ({ id, metadata: row.metadata, current_period_end: row.current_period_end, canceled_at: row.canceled_at })
const isPro = (row: { status: string; current_period_end: string | null }) => influencerSubscriptionGrantsPro(row, NOW.getTime())

const ACTIVE: PayPalSubscriptionSnapshot = {
  status: 'ACTIVE', start_time: '2026-09-29T15:08:25Z', subscriber: { payer_id: 'PAYER' },
  billing_info: { next_billing_time: '2026-10-29T10:00:00Z', last_payment: { time: '2026-09-29T15:11:00Z' } },
}
const RENEWED: PayPalSubscriptionSnapshot = { ...ACTIVE, billing_info: { next_billing_time: '2026-11-29T10:00:00Z', last_payment: { time: '2026-10-29T10:05:00Z' } } }
const CANCELLED: PayPalSubscriptionSnapshot = { ...ACTIVE, status: 'CANCELLED', billing_info: { last_payment: { time: '2026-09-29T15:11:00Z' } } }

// ── Regla de negocio: quién es Pro ─────────────────────────────────────────

test('usuario Free: sin suscripción o incomplete no es Pro', () => {
  assert.equal(isPro({ status: 'incomplete', current_period_end: '2026-12-01T00:00:00Z' }), false)
})
test('usuario Pro: active es Pro', () => assert.equal(isPro({ status: 'active', current_period_end: null }), true))
test('usuario trialing: es Pro', () => assert.equal(isPro({ status: 'trialing', current_period_end: null }), true))
test('active con período vencido sigue Pro hasta que PayPal diga otra cosa (fallo de webhook ≠ Free)', () => {
  assert.equal(isPro({ status: 'active', current_period_end: '2026-10-01T00:00:00Z' }), true)
})
test('cancelada con período pagado vigente: sigue Pro', () => assert.equal(isPro({ status: 'canceled', current_period_end: '2026-10-29T00:00:00Z' }), true))
test('expiración: cancelada con período vencido ya no es Pro', () => assert.equal(isPro({ status: 'canceled', current_period_end: '2026-10-01T00:00:00Z' }), false))
test('suspensión (pago fallido): past_due no da Pro', () => assert.equal(isPro({ status: 'past_due', current_period_end: '2026-10-29T00:00:00Z' }), false))

// ── PayPal ACTIVE → DB ACTIVE → API PRO ────────────────────────────────────

test('pago exitoso: PayPal ACTIVE → fila active con período hasta el próximo cobro → Pro', () => {
  const row = sync(ACTIVE)
  assert.equal(row.status, 'active')
  assert.equal(row.current_period_end, '2026-10-29T10:00:00.000Z')
  assert.equal(row.paypal_payer_id, 'PAYER')
  assert.deepEqual(row.metadata, { account_type: 'influencer', influencer_id: 'inf-1', campaign_commitments: [] })
  assert.equal(row.canceled_at, null)
  assert.equal(isPro(row), true)
})

test('webhook duplicado: PayPal ACTIVE dos veces → misma fila, sigue Pro', () => {
  const first = sync(ACTIVE)
  const second = sync(ACTIVE, asStored(first))
  assert.deepEqual({ ...second, updated_at: null }, { ...first, updated_at: null })
  assert.equal(isPro(second), true)
})

test('webhook antiguo CANCELLED con PayPal ACTIVE → NO se vuelve Free (se sincroniza con el estado real)', () => {
  // El builder solo recibe el estado ACTUAL de PayPal: el payload del evento
  // viejo no participa. Si PayPal hoy dice ACTIVE, la fila queda active.
  const stored = asStored(sync(ACTIVE))
  const row = sync(ACTIVE, stored)
  assert.equal(row.status, 'active')
  assert.equal(isPro(row), true)
})

test('renovación: adelanta current_period_end', () => {
  const row = sync(RENEWED, asStored(sync(ACTIVE)))
  assert.equal(row.current_period_end, '2026-11-29T10:00:00.000Z')
  assert.equal(isPro(row), true)
})

test('evento fuera de orden: un estado viejo de PayPal nunca retrocede el período', () => {
  const renewed = asStored(sync(RENEWED))
  const row = sync(ACTIVE, renewed)
  assert.equal(row.current_period_end, '2026-11-29T10:00:00.000Z')
})

test('cancelación: conserva Pro hasta el fin del período pagado y marca la cancelación', () => {
  const row = sync(CANCELLED, asStored(sync(ACTIVE)))
  assert.equal(row.status, 'canceled')
  // Nunca antes del período ya guardado (10:00); PayPal informa último pago + 1 mes (15:11).
  assert.equal(row.current_period_end, '2026-10-29T15:11:00.000Z')
  assert.equal((row.metadata as Record<string, unknown>).cancel_at_period_end, true)
  assert.ok(row.canceled_at)
  assert.equal(isPro(row), true)
})

test('cancelación repetida: no cambia canceled_at ni el período', () => {
  const first = sync(CANCELLED, asStored(sync(ACTIVE)))
  const second = sync(CANCELLED, asStored(first))
  assert.equal(second.canceled_at, first.canceled_at)
  assert.equal(second.current_period_end, first.current_period_end)
})

test('suspensión: PayPal SUSPENDED → past_due', () => {
  assert.equal(sync({ ...ACTIVE, status: 'SUSPENDED' }, asStored(sync(ACTIVE))).status, 'past_due')
})

test('la metadata existente se conserva (re-vínculo, compromisos)', () => {
  const stored: StoredInfluencerSubscription = { id: 's', current_period_end: null, canceled_at: null, metadata: { account_type: 'influencer', influencer_id: 'inf-1', relinked_from: 'old-id', campaign_commitments: ['c1'] } }
  const row = sync(ACTIVE, stored)
  assert.equal((row.metadata as Record<string, unknown>).relinked_from, 'old-id')
  assert.deepEqual((row.metadata as Record<string, unknown>).campaign_commitments, ['c1'])
})

test('estado desconocido de PayPal → incomplete (no inventa Pro)', () => {
  assert.equal(sync({ ...ACTIVE, status: 'WHATEVER' }).status, 'incomplete')
})

test('payPalPaidThrough: cancelada sin next_billing_time usa último pago + 1 mes', () => {
  assert.equal(payPalPaidThrough(CANCELLED), '2026-10-29T15:11:00.000Z')
})

// ── Contratos de las rutas (lectura de fuente) ─────────────────────────────

const webhook = readFileSync(new URL('../src/app/api/paypal/webhook/route.ts', import.meta.url), 'utf8')
const complete = readFileSync(new URL('../src/app/api/influencer/paypal/complete/route.ts', import.meta.url), 'utf8')
const billing = readFileSync(new URL('../src/app/api/influencer/billing/route.ts', import.meta.url), 'utf8')
const profile = readFileSync(new URL('../src/app/(influencer)/inf-profile/page.tsx', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../supabase/migrations/20261008120000_block_delete_influencer_with_billing.sql', import.meta.url), 'utf8')
const hardDelete = readFileSync(new URL('../src/lib/influencers/hardDelete.ts', import.meta.url), 'utf8')
const adminList = readFileSync(new URL('../src/app/(dashboard)/admin-influencers/InfluencersClient.tsx', import.meta.url), 'utf8')
const ensureOrg = readFileSync(new URL('../src/lib/supabase/ensureOrg.ts', import.meta.url), 'utf8')

test('webhook fallido: si no puede leer PayPal pide reintento (502), no responde 200', () => {
  assert.match(webhook, /Unable to read PayPal subscription' \}, \{ status: 502 \}/)
})
test('webhook y checkout usan el mismo builder (una sola regla de sincronización)', () => {
  assert.match(webhook, /buildInfluencerSubscriptionRow\(/)
  assert.match(complete, /buildInfluencerSubscriptionRow\(/)
})
test('un cobro de Pro re-sincroniza la suscripción (renovación sin BILLING.*)', () => {
  assert.match(webhook, /syncInfluencerSubscription\(paypalSubscriptionId, details\)/)
})
test('cobro de una suscripción sin ficha: se registra sin vínculo y deja rastro', () => {
  assert.match(webhook, /INFLUENCER_PRO_ORPHAN: cobro/)
  assert.match(webhook, /INFLUENCER_PRO_ORPHAN: la suscripción no tiene ficha/)
})
test('billing muestra la suscripción que da Pro, no un checkout abandonado más reciente', () => {
  assert.match(billing, /find\(row => influencerSubscriptionGrantsPro\(row\)\)/)
})
test('cache/sesión: el plan se consulta sin cache y un error no se muestra como "Gratis"', () => {
  assert.match(profile, /fetch\('\/api\/influencer\/billing', \{ cache: 'no-store' \}\)/)
  assert.match(profile, /useState<boolean \| null>\(null\)/)
  assert.match(profile, /isPro !== null &&/)
})
test('base de datos: una ficha con suscripción o pagos no se puede borrar físicamente', () => {
  assert.match(migration, /before delete on public\.influencers/)
  assert.match(migration, /s\.status <> 'incomplete'/)
  assert.match(migration, /from public\.subscription_payments p/)
})

// ── Identidad estable y reconciliación (caso Tiare, sin datos fijos) ───────

test('la suscripción guarda la identidad estable (user_id) además de la ficha', () => {
  const row = buildInfluencerSubscriptionRow({ details: ACTIVE, paypalSubscriptionId: 'I-TEST', existing: null, influencer: { ...influencer, user_id: 'user-1' }, planId: 'p', campaignId: null, now: NOW })
  assert.equal((row.metadata as Record<string, unknown>).user_id, 'user-1')
})

test('PayPal ACTIVE + ficha original borrada + usuario con ficha nueva → se re-vincula y sigue Pro', () => {
  const stored: StoredInfluencerSubscription = { id: 's', current_period_end: '2026-10-29T10:00:00Z', canceled_at: null, metadata: { account_type: 'influencer', influencer_id: 'ficha-borrada', user_id: 'user-1', campaign_commitments: [] } }
  const row = buildInfluencerSubscriptionRow({ details: ACTIVE, paypalSubscriptionId: 'I-TEST', existing: stored, influencer: { id: 'ficha-nueva', organization_id: 'org-1', user_id: 'user-1' }, planId: 'p', campaignId: null, now: NOW })
  const metadata = row.metadata as Record<string, unknown>
  assert.equal(metadata.influencer_id, 'ficha-nueva')
  assert.equal(metadata.relinked_from, 'ficha-borrada')
  assert.equal(row.status, 'active')
  assert.equal(isPro(row), true)
})

test('reconciliación: solo re-vincula suscripciones cuya ficha ya no existe', () => {
  const subs = [
    { id: 'huérfana', metadata: { influencer_id: 'ficha-borrada', user_id: 'user-1' } },
    { id: 'viva', metadata: { influencer_id: 'otra-ficha-existente', user_id: 'user-1' } },
    { id: 'ya-vinculada', metadata: { influencer_id: 'ficha-nueva', user_id: 'user-1' } },
    { id: 'sin-ficha', metadata: { user_id: 'user-1' } },
  ]
  assert.deepEqual(selectOrphanSubscriptionsToRelink(subs, new Set(['otra-ficha-existente', 'ficha-nueva']), 'ficha-nueva'), ['huérfana'])
})

test('reconciliación idempotente: correr dos veces no mueve nada más', () => {
  assert.deepEqual(selectOrphanSubscriptionsToRelink([{ id: 's', metadata: { influencer_id: 'ficha-nueva' } }], new Set(['ficha-nueva']), 'ficha-nueva'), [])
})

test('la ficha nueva y la pantalla del plan reconcilian el Pro del mismo usuario', () => {
  assert.match(ensureOrg, /reconcileOrphanProSubscriptions\(admin, \{ id: influencer\.id, user_id: user\.id \}\)/)
  assert.match(billing, /reconcileOrphanProSubscriptions\(admin, influencer\)/)
  assert.match(webhook, /eq\('user_id', linkedMetadata\.user_id\)/)
})

// ── Borrado físico seguro (bug del borrado masivo del 04-10) ───────────────

test('borrado físico: bloquea Pro, suscripciones, pagos y por defecto todo historial comercial', () => {
  assert.match(hardDelete, /neq\('status', 'incomplete'\)/)
  assert.match(hardDelete, /from\('subscription_payments'\)/)
  for (const table of ['campaign_influencers', 'campaign_deliverables', 'contracts', 'payroll_items', 'bookings', 'influencer_terms_acceptances']) {
    assert.match(hardDelete, new RegExp(`table: '${table}'`))
  }
  assert.match(hardDelete, /protection: DeleteProtection = 'history'/)
})

test('admin: "seleccionar todo" y las acciones masivas usan solo las filas visibles (lib/influencers/selection)', () => {
  assert.match(adminList, /toggleAllVisible\(prev, visibleInfluencers\.map\(i => i\.id\)\)/)
  assert.equal((adminList.match(/idsForBulkAction\(selectedIds, visibleInfluencers\.map\(inf => inf\.id\)\)/g) ?? []).length, 3)
  assert.doesNotMatch(adminList, /Array\.from\(selectedIds\)/)
  assert.doesNotMatch(adminList, /new Set\(influencers\.map\(i => i\.id\)\)/)
})
