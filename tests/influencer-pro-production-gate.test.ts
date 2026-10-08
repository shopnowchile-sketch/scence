// Production gate Influencer Pro (2026-10-08): escenarios A–M de punta a punta
// sobre la lógica real (builder, reconciliación, hardDelete, selección admin)
// con una base en memoria. Complementa tests/influencer-pro-integrity.test.ts.
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { readFileSync } from 'node:fs'

register('./support/ts-resolve.mjs', import.meta.url)
const { createFakeSupabase } = await import('./support/fake-supabase.ts')
const PAY = await import('../src/lib/influencer-paypal.ts')
const PRO = await import('../src/lib/influencer-pro.ts')
const HD = await import('../src/lib/influencers/hardDelete.ts')
const SEL = await import('../src/lib/influencers/selection.ts')

const NOW = new Date('2026-10-08T12:00:00Z')
const ACTIVE = { status: 'ACTIVE', start_time: '2026-09-29T15:08:25Z', subscriber: { payer_id: 'P' }, billing_info: { next_billing_time: '2026-10-29T10:00:00Z', last_payment: { time: '2026-09-29T15:11:00Z' } } }
const sync = (details: object, existing: unknown, influencer = { id: 'inf', organization_id: 'org', user_id: 'user' }) =>
  PAY.buildInfluencerSubscriptionRow({ details, paypalSubscriptionId: 'I-1', existing: existing as never, influencer, planId: 'pro', campaignId: null, now: NOW })
const stored = (row: { metadata: unknown; current_period_end: string; canceled_at: string | null }) => ({ id: 's1', metadata: row.metadata, current_period_end: row.current_period_end, canceled_at: row.canceled_at })
const proOf = async (tables: Record<string, Record<string, unknown>[]>, id: string) => PRO.isInfluencerPro(createFakeSupabase(tables).client, id)

test('A. usuario nuevo Free: sin suscripción no es Pro', async () => {
  assert.equal(await proOf({ subscriptions: [], influencers: [{ id: 'inf', metadata: {} }] }, 'inf'), false)
})

test('B. usuario compra Pro: PayPal ACTIVE → fila active con user_id → API Pro', async () => {
  const row = sync(ACTIVE, null)
  assert.equal(row.status, 'active')
  assert.equal((row.metadata as Record<string, unknown>).user_id, 'user')
  assert.equal(await proOf({ subscriptions: [{ id: 's1', ...row }], influencers: [{ id: 'inf', metadata: {} }] }, 'inf'), true)
})

test('C. Pro existente: active sigue Pro aunque el período guardado esté atrasado', async () => {
  assert.equal(await proOf({ subscriptions: [{ id: 's1', status: 'active', current_period_end: '2026-10-01T00:00:00Z', metadata: { influencer_id: 'inf' } }], influencers: [] }, 'inf'), true)
})

test('D. Pro renueva: el período avanza', () => {
  const first = sync(ACTIVE, null)
  const renewed = sync({ ...ACTIVE, billing_info: { next_billing_time: '2026-11-29T10:00:00Z' } }, stored(first))
  assert.equal(renewed.current_period_end, '2026-11-29T10:00:00.000Z')
})

test('E. Pro cancela: conserva Pro hasta fin del período; vencido ya no', async () => {
  const canceled = sync({ ...ACTIVE, status: 'CANCELLED', billing_info: { last_payment: { time: '2026-09-29T15:11:00Z' } } }, stored(sync(ACTIVE, null)))
  assert.equal(canceled.status, 'canceled')
  assert.equal(PAY.influencerSubscriptionGrantsPro(canceled, NOW.getTime()), true)
  assert.equal(PAY.influencerSubscriptionGrantsPro(canceled, Date.parse('2026-11-01T00:00:00Z')), false)
})

// Caso Tiare, con ids ficticios: suscripción de la ficha borrada, usuario con ficha nueva.
function orphanScenario() {
  return createFakeSupabase({
    influencers: [{ id: 'ficha-nueva', user_id: 'user-t', metadata: {} }],
    subscriptions: [
      { id: 'sub-t', status: 'active', current_period_end: '2026-10-29T10:00:00Z', paypal_subscription_id: 'I-T', metadata: { account_type: 'influencer', influencer_id: 'ficha-borrada', user_id: 'user-t' } },
      { id: 'sub-otro', status: 'active', current_period_end: '2026-10-29T10:00:00Z', paypal_subscription_id: 'I-O', metadata: { account_type: 'influencer', influencer_id: 'ficha-borrada-2', user_id: 'user-otro' } },
    ],
    subscription_payments: [{ id: 'pay-t', subscription_id: 'sub-t', influencer_id: null }],
  })
}

test('F/G. ficha eliminada y recreada: la suscripción huérfana vuelve a la ficha nueva del MISMO usuario → Pro', async () => {
  const db = orphanScenario()
  assert.equal(await PRO.isInfluencerPro(db.client, 'ficha-nueva'), false)
  const moved = await PRO.reconcileOrphanProSubscriptions(db.client, { id: 'ficha-nueva', user_id: 'user-t' })
  assert.equal(moved, 1)
  const sub = db.tables.subscriptions.find(row => row.id === 'sub-t')!
  assert.equal((sub.metadata as Record<string, unknown>).influencer_id, 'ficha-nueva')
  assert.equal((sub.metadata as Record<string, unknown>).relinked_from, 'ficha-borrada')
  assert.equal(sub.status, 'active')
  assert.equal(sub.current_period_end, '2026-10-29T10:00:00Z')
  assert.equal(db.tables.subscription_payments[0].influencer_id, 'ficha-nueva')
  assert.equal(db.tables.subscriptions.length, 2, 'no crea suscripciones')
  assert.equal(await PRO.isInfluencerPro(db.client, 'ficha-nueva'), true)
  // La huérfana de OTRO usuario no se toca.
  assert.equal((db.tables.subscriptions[1].metadata as Record<string, unknown>).influencer_id, 'ficha-borrada-2')
  // Idempotente.
  assert.equal(await PRO.reconcileOrphanProSubscriptions(db.client, { id: 'ficha-nueva', user_id: 'user-t' }), 0)
})

test('G. sin user_id en la suscripción no se adivina identidad', async () => {
  const db = createFakeSupabase({ influencers: [{ id: 'nueva', user_id: 'u' }], subscriptions: [{ id: 's', status: 'active', metadata: { influencer_id: 'borrada' } }] })
  assert.equal(await PRO.reconcileOrphanProSubscriptions(db.client, { id: 'nueva', user_id: 'u' }), 0)
})

test('H. webhook duplicado: misma fila, sigue Pro', () => {
  const first = sync(ACTIVE, null)
  const again = sync(ACTIVE, stored(first))
  assert.deepEqual({ ...again, updated_at: 0 }, { ...first, updated_at: 0 })
})

test('I. webhook atrasado: un estado viejo nunca retrocede el período ni quita Pro', () => {
  const renewed = sync({ ...ACTIVE, billing_info: { next_billing_time: '2026-11-29T10:00:00Z' } }, null)
  const late = sync(ACTIVE, stored(renewed))
  assert.equal(late.current_period_end, '2026-11-29T10:00:00.000Z')
  assert.equal(late.status, 'active')
})

test('J. PayPal caído: el webhook responde 502 (PayPal reintenta), no 200 ni Free', () => {
  const webhook = readFileSync(new URL('../src/app/api/paypal/webhook/route.ts', import.meta.url), 'utf8')
  assert.match(webhook, /if \(!detailsResponse\.ok \|\| !subscription\) \{[\s\S]{0,300}status: 502/)
  assert.match(webhook, /cobro registrado pero no se pudo leer la suscripción en PayPal[\s\S]{0,300}status: 502/)
})

const baseInfluencer = { id: 'inf', organization_id: 'org', metadata: {} }

test('K. hard delete de una Pro: bloqueado y no borra NADA (ni hijos)', async () => {
  const db = createFakeSupabase({
    influencers: [baseInfluencer],
    subscriptions: [{ id: 's', status: 'active', current_period_end: null, metadata: { influencer_id: 'inf' } }],
    campaign_influencers: [{ id: 'ci', influencer_id: 'inf' }],
  })
  await assert.rejects(HD.hardDeleteInfluencers(db.client, 'org', ['inf']), (error: Error) => error instanceof HD.InfluencerNotDeletableError && /Plan Pro/.test(error.message))
  assert.equal(db.writes.length, 0)
  assert.equal(db.tables.influencers.length, 1)
})

for (const [table, label] of [
  ['subscription_payments', 'pagos'], ['campaign_influencers', 'postulación'], ['bookings', 'reserva'], ['contracts', 'contrato'],
  ['payroll_items', 'payroll'], ['campaign_deliverables', 'entregable'], ['barters', 'canje'], ['commission_settlements', 'comisión'],
  ['influencer_terms_acceptances', 'términos'], ['influencer_documents', 'documentos'],
] as const) {
  test(`L. hard delete con historial (${label}): bloqueado vía API y sin escrituras`, async () => {
    const db = createFakeSupabase({ influencers: [baseInfluencer], subscriptions: [], [table]: [{ id: 'x', influencer_id: 'inf' }] })
    await assert.rejects(HD.hardDeleteInfluencers(db.client, 'org', ['inf']), HD.InfluencerNotDeletableError)
    assert.equal(db.writes.length, 0)
  })
}

test('L. suscripción cancelada vencida también bloquea (historial financiero)', async () => {
  const db = createFakeSupabase({ influencers: [baseInfluencer], subscriptions: [{ id: 's', status: 'canceled', current_period_end: '2026-01-01T00:00:00Z', metadata: { influencer_id: 'inf' } }] })
  await assert.rejects(HD.hardDeleteInfluencers(db.client, 'org', ['inf']), HD.InfluencerNotDeletableError)
})

test('L. ficha sin historial (solo checkout abandonado): sí se puede borrar (flujo normal)', async () => {
  const db = createFakeSupabase({ influencers: [baseInfluencer], subscriptions: [{ id: 's', status: 'incomplete', metadata: { influencer_id: 'inf' } }] })
  const result = await HD.hardDeleteInfluencers(db.client, 'org', ['inf'])
  assert.equal(result.deleted, 1)
})

test('L. lote mixto: si una tiene historial, no se borra ninguna', async () => {
  const db = createFakeSupabase({ influencers: [baseInfluencer, { id: 'limpia', organization_id: 'org', metadata: {} }], subscriptions: [], contracts: [{ id: 'c', influencer_id: 'inf' }] })
  await assert.rejects(HD.hardDeleteInfluencers(db.client, 'org', ['inf', 'limpia']), (error: InstanceType<typeof HD.InfluencerNotDeletableError>) => error.proIds.length === 1 && error.proIds[0] === 'inf')
  assert.equal(db.tables.influencers.length, 2)
})

test('L. merge autorizado: solo bloquea facturación; historial comercial no lo frena', async () => {
  const db = createFakeSupabase({ influencers: [baseInfluencer], subscriptions: [], campaign_influencers: [{ id: 'ci', influencer_id: 'inf' }] })
  await HD.assertNoProInfluencers(db.client, ['inf'], 'billing')
  const paid = createFakeSupabase({ influencers: [baseInfluencer], subscriptions: [], subscription_payments: [{ id: 'p', influencer_id: 'inf' }] })
  await assert.rejects(HD.assertNoProInfluencers(paid.client, ['inf'], 'billing'), HD.InfluencerNotDeletableError)
})

test('M. filtro "Sin Instagram" (12 visibles de 48 cargadas) → seleccionar todo → eliminar: solo las 12', () => {
  const loaded = Array.from({ length: 48 }, (_, i) => `inf-${i}`)
  const visible = loaded.slice(0, 12)
  const selected = SEL.toggleAllVisible(new Set(), visible)
  assert.equal(selected.size, 12)
  assert.deepEqual(SEL.idsForBulkAction(selected, visible), visible)
  // Selección vieja que incluye filas ocultas: nunca se actúa sobre ellas.
  assert.deepEqual(SEL.idsForBulkAction(new Set(loaded), visible), visible)
  // Segundo clic: deselecciona.
  assert.equal(SEL.toggleAllVisible(selected, visible).size, 0)
  // Sin filas visibles: no selecciona nada.
  assert.equal(SEL.toggleAllVisible(new Set(), []).size, 0)
})

test('Protección en 3 capas: UI + API/server (todas las rutas pasan por hardDelete) + DB', () => {
  const routes = ['bulk-delete/route.ts', 'delete-no-instagram/route.ts', '[id]/route.ts', 'merge/route.ts']
  for (const route of routes) {
    const source = readFileSync(new URL(`../src/app/api/influencers/${route}`, import.meta.url), 'utf8')
    assert.match(source, /hardDeleteInfluencers\(/, route)
  }
  const migration = readFileSync(new URL('../supabase/migrations/20261008120000_block_delete_influencer_with_billing.sql', import.meta.url), 'utf8')
  assert.match(migration, /before delete on public\.influencers/)
})
