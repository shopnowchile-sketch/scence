// Mensualidad PayPal por marca (Impulso Consulting): checkout, verificación en backend y webhook.
// PayPal está SIMULADO con un fetch en memoria (sin credenciales ni red): prueba la lógica de SCENCE, no PayPal real.
// La prueba real contra PayPal Sandbox requiere PAYPAL_CLIENT_ID/SECRET y un plan de agencia (ver docs).
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('./support/ts-resolve.mjs', import.meta.url)
register('./support/route-harness.mjs', import.meta.url)
const { makeAdmin } = await import('./support/memory-supabase.ts')

type Row = Record<string, any>
const UUID_A = '11111111-1111-4111-8111-111111111111'
const UUID_B = '22222222-2222-4222-8222-222222222222'
const UUID_IC = '33333333-3333-4333-8333-333333333333'
const PLAN = 'plan-agency-row'
process.env.PAYPAL_CLIENT_ID = 'test-id'; process.env.PAYPAL_CLIENT_SECRET = 'test-secret'; process.env.PAYPAL_ENV = 'sandbox'
process.env.PAYPAL_AGENCY_PLAN_ID = 'P-AGENCY'; process.env.RESEND_API_KEY = 're_test'

const FUTURE = new Date(Date.now() + 25 * 86_400_000).toISOString()
const fresh = (): Record<string, Row[]> => ({
  organizations: [{ id: 'org-IC', settings: { agency_portal: true } }, { id: 'org-A', settings: {} }, { id: 'org-B', settings: {} }],
  organization_members: [{ id: 'm1', user_id: 'isabel', organization_id: 'org-IC', role: 'brand_manager', is_owner: true, is_active: true, brand_id: UUID_IC }],
  brands: [
    { id: UUID_IC, name: 'IC', organization_id: 'org-IC', status: 'approved', metadata: {}, subscription_plan_override: null },
    { id: UUID_A, name: 'A', organization_id: 'org-A', status: 'approved', metadata: { managed_by_org_id: 'org-IC' }, subscription_plan_override: null },
    { id: UUID_B, name: 'B', organization_id: 'org-B', status: 'approved', metadata: { managed_by_org_id: 'org-IC' }, subscription_plan_override: null },
  ],
  subscription_plans: [{ id: PLAN, tier: 'agency', is_active: true }],
  subscriptions: [], subscription_payments: [],
})

type PayPalState = { plans: Record<string, any>; subscriptions: Record<string, any>; created: any[]; cancelled: string[] }
const installPayPal = (state: PayPalState) => {
  ;(globalThis as any).fetch = async (url: string, init: any = {}) => {
    const json = (body: unknown, status = 200) => ({ ok: status < 300, status, json: async () => body })
    if (url.endsWith('/v1/oauth2/token')) return json({ access_token: 'tok' })
    if (url.includes('/v1/billing/plans/')) return json(state.plans[decodeURIComponent(url.split('/').pop()!)] ?? { message: 'nope' }, state.plans[decodeURIComponent(url.split('/').pop()!)] ? 200 : 404)
    if (url.endsWith('/v1/billing/subscriptions') && init.method === 'POST') {
      const body = JSON.parse(init.body)
      const id = `I-${state.created.length + 1}`
      state.created.push({ id, ...body, requestId: init.headers['PayPal-Request-Id'] })
      state.subscriptions[id] = { id, status: 'APPROVAL_PENDING', plan_id: body.plan_id, custom_id: body.custom_id, start_time: new Date().toISOString(), billing_info: { next_billing_time: FUTURE } }
      return json({ id, links: [{ rel: 'approve', href: `https://paypal.test/approve/${id}` }] }, 201)
    }
    const sub = url.match(/\/v1\/billing\/subscriptions\/([^/?]+)(\/cancel)?/)
    if (sub) {
      if (sub[2]) { state.cancelled.push(sub[1]); return json({}, 204) }
      const found = state.subscriptions[decodeURIComponent(sub[1])]
      return found ? json(found) : json({ message: 'not found' }, 404)
    }
    return json({ ok: true })   // correo (Resend) simulado
  }
}
const pp = (): PayPalState => ({ plans: { 'P-AGENCY': { id: 'P-AGENCY', billing_cycles: [{ pricing_scheme: { fixed_price: { value: '74.50', currency_code: 'USD' } } }] } }, subscriptions: {}, created: [], cancelled: [] })
const req = (url: string, body?: unknown) => ({ url, json: async () => body, headers: new Headers(), nextUrl: new URL(url) }) as any
const as = (user: string | null, db: Record<string, Row[]>, cookies: Record<string, string> = {}) => {
  ;(globalThis as any).__routeHarness = { user: user ? { id: user, email: `${user}@scence-test.invalid` } : null, admin: makeAdmin(db, { autoId: true }), cookies }
}
const checkout = () => import('../src/app/api/paypal/checkout/route.ts') as Promise<any>
const complete = () => import('../src/app/api/paypal/complete/route.ts') as Promise<any>

test('GET checkout: muestra el monto exacto en USD leído del plan de PayPal', async () => {
  installPayPal(pp()); as('isabel', fresh())
  const res = await (await checkout()).GET(req(`http://localhost/api/paypal/checkout?tier=agency&brand_id=${UUID_A}`))
  assert.equal(res.status, 200)
  const json = await res.json()
  assert.equal(json.amount_usd, '74.50'); assert.equal(json.currency, 'USD'); assert.equal(json.price_clp, 69900); assert.equal(json.commitment_months, 3)
  assert.equal(json.brand_id, UUID_A); assert.equal(json.already_current, false)
})

test('POST checkout: crea la suscripción atada a ESA marca y la registra incomplete (no activa nada)', async () => {
  const state = pp(); installPayPal(state); const db = fresh(); as('isabel', db)
  const res = await (await checkout()).POST(req('http://localhost/api/paypal/checkout', { tier: 'agency', brand_id: UUID_A }))
  assert.equal(res.status, 200)
  const created = state.created[0]
  assert.equal(created.plan_id, 'P-AGENCY'); assert.equal(created.custom_id, `org-A:${PLAN}:agency:${UUID_A}`)
  assert.match(created.application_context.return_url, new RegExp(`brand=${UUID_A}`))
  assert.deepEqual(db.subscriptions.map(r => [r.organization_id, r.status, r.metadata.brand_id]), [['org-A', 'incomplete', UUID_A]])
})

test('POST checkout: dos marcas, dos suscripciones; nunca se comparte', async () => {
  const state = pp(); installPayPal(state); const db = fresh(); as('isabel', db)
  const route = await checkout()
  await route.POST(req('http://localhost/api/paypal/checkout', { tier: 'agency', brand_id: UUID_A }))
  await route.POST(req('http://localhost/api/paypal/checkout', { tier: 'agency', brand_id: UUID_B }))
  assert.equal(state.created.length, 2)
  assert.notEqual(state.created[0].requestId, state.created[1].requestId)
  assert.deepEqual(db.subscriptions.map(r => r.metadata.brand_id).sort(), [UUID_A, UUID_B].sort())
})

test('POST checkout: con mensualidad vigente responde 409 y no crea otra suscripción (sin doble cobro)', async () => {
  const state = pp(); installPayPal(state); const db = fresh()
  db.subscriptions.push({ id: 's1', organization_id: 'org-A', status: 'active', current_period_end: FUTURE, paypal_subscription_id: 'I-old', metadata: { account_type: 'brand', brand_id: UUID_A }, plan: { tier: 'agency' } })
  as('isabel', db)
  const res = await (await checkout()).POST(req('http://localhost/api/paypal/checkout', { tier: 'agency', brand_id: UUID_A }))
  assert.equal(res.status, 409); assert.equal((await res.json()).code, 'ALREADY_ACTIVE'); assert.equal(state.created.length, 0)
})

test('POST checkout: marca ajena a la agencia, o usuario que no es agencia → sin checkout', async () => {
  const state = pp(); installPayPal(state); const db = fresh()
  db.brands.push({ id: '44444444-4444-4444-8444-444444444444', name: 'Ajena', organization_id: 'org-Z', status: 'approved', metadata: {} })
  as('isabel', db)
  const alien = await (await checkout()).POST(req('http://localhost/api/paypal/checkout', { tier: 'agency', brand_id: '44444444-4444-4444-8444-444444444444' }))
  assert.notEqual(alien.status, 200)
  db.organization_members.push({ id: 'm9', user_id: 'plain', organization_id: 'org-A', role: 'brand_manager', is_owner: true, is_active: true, brand_id: UUID_A })
  as('plain', db)
  const plain = await (await checkout()).POST(req('http://localhost/api/paypal/checkout', { tier: 'agency', brand_id: UUID_B }))
  assert.notEqual(plain.status, 200)
  assert.equal(state.created.length, 0)
})

test('complete: volver de PayPal sin ACTIVE no activa; con ACTIVE verificado en backend sí, sin aprobar nada', async () => {
  const state = pp(); installPayPal(state); const db = fresh(); as('isabel', db)
  await (await checkout()).POST(req('http://localhost/api/paypal/checkout', { tier: 'agency', brand_id: UUID_A }))
  const id = state.created[0].id
  const route = await complete()
  const pending = await route.POST(req(`http://localhost/api/paypal/complete?subscription_id=${id}`))
  assert.equal(pending.status, 409)
  assert.equal(db.subscriptions[0].status, 'incomplete', 'regresar de PayPal no cuenta como pago')
  state.subscriptions[id].status = 'ACTIVE'
  const ok = await route.POST(req(`http://localhost/api/paypal/complete?subscription_id=${id}`))
  assert.equal(ok.status, 200)
  assert.equal(db.subscriptions[0].status, 'active'); assert.equal(db.subscriptions[0].metadata.brand_id, UUID_A)
  assert.equal(db.brands.find(b => b.id === UUID_A)!.status, 'approved')
})

test('complete: la suscripción de la marca A no sirve para pagar en nombre de otra marca ni de otro usuario', async () => {
  const state = pp(); installPayPal(state); const db = fresh(); as('isabel', db)
  await (await checkout()).POST(req('http://localhost/api/paypal/checkout', { tier: 'agency', brand_id: UUID_A }))
  const id = state.created[0].id; state.subscriptions[id].status = 'ACTIVE'
  // custom_id alterado hacia otra organización
  state.subscriptions[id].custom_id = `org-B:${PLAN}:agency:${UUID_A}`
  const forged = await (await complete()).POST(req(`http://localhost/api/paypal/complete?subscription_id=${id}`))
  assert.notEqual(forged.status, 200)
  state.subscriptions[id].custom_id = `org-A:${PLAN}:agency:${UUID_A}`
  as('nadie', db)
  const stranger = await (await complete()).POST(req(`http://localhost/api/paypal/complete?subscription_id=${id}`))
  assert.notEqual(stranger.status, 200)
  assert.equal(db.subscriptions[0].status, 'incomplete')
})

test('webhook: el cobro mensual se registra una sola vez y re-sincroniza el período de ESA marca', async () => {
  const state = pp(); installPayPal(state); const db = fresh(); as('isabel', db)
  process.env.PAYPAL_WEBHOOK_ID = 'WH-1'
  const base = (globalThis as any).fetch
  ;(globalThis as any).fetch = async (url: string, init: any) => url.endsWith('/verify-webhook-signature') ? ({ ok: true, status: 200, json: async () => ({ verification_status: 'SUCCESS' }) }) : base(url, init)
  await (await checkout()).POST(req('http://localhost/api/paypal/checkout', { tier: 'agency', brand_id: UUID_A }))
  const id = state.created[0].id; state.subscriptions[id].status = 'ACTIVE'
  const webhook = await import('../src/app/api/paypal/webhook/route.ts') as any
  const sale = { event_type: 'PAYMENT.SALE.COMPLETED', resource: { id: 'SALE-1', billing_agreement_id: id, amount: { total: '74.50', currency: 'USD' }, create_time: new Date().toISOString() } }
  const post = () => webhook.POST({ json: async () => sale, headers: new Headers() } as any)
  assert.equal((await post()).status, 200)
  assert.equal((await post()).status, 200)   // PayPal reintenta el mismo evento
  assert.equal(db.subscription_payments.length, 1, 'misma mensualidad, un solo registro')
  assert.equal(db.subscription_payments[0].organization_id, 'org-A')
  assert.equal(db.subscriptions[0].status, 'active')
  assert.equal(db.subscriptions[0].current_period_end, FUTURE)
  assert.equal(db.subscriptions[0].metadata.brand_id, UUID_A)
})
