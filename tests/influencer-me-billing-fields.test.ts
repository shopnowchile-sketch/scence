// /api/influencer/me no devuelve organization_id; /api/influencer/billing devuelve solo campos permitidos.
// Base en memoria; sin red ni producción. LÍMITE: no prueba la UI ni los campos de ubicación oficial.
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('./support/ts-resolve.mjs', import.meta.url)
register('./support/route-harness.mjs', import.meta.url)
const { makeAdmin } = await import('./support/memory-supabase.ts')

type Row = Record<string, any>
const fresh = (): Record<string, Row[]> => ({
  influencers: [
    { id: 'inf-1', user_id: 'u1', display_name: 'Ana', email: 'a@x.cl', organization_id: 'org-secreta', is_active: true, location_id: null, tags: [], categories: [] },
    { id: 'inf-2', user_id: 'u2', display_name: 'Bea', email: 'b@x.cl', organization_id: 'org-secreta', is_active: true, location_id: null },
  ],
  influencer_social_profiles: [{ id: 'sp1', influencer_id: 'inf-1', platform: 'instagram', username: 'ana', followers: 1 }],
  locations: [], brands: [],
  subscription_plans: [{ id: 'plan-1', name: 'Pro', tier: 'pro' }],
  subscriptions: [{
    id: 'sub-1', status: 'active', current_period_end: '2026-12-01T00:00:00Z', started_paying_at: '2026-10-01T00:00:00Z', canceled_at: null,
    paypal_subscription_id: 'I-SECRETO', plan_id: 'plan-1', plan: { name: 'Pro', tier: 'pro' }, created_at: '2026-10-01T00:00:00Z',
    metadata: { influencer_id: 'inf-1', user_id: 'u1', paypal_internal: 'x' },
  }],
  subscription_payments: [
    { id: 'pay-1', influencer_id: 'inf-1', payer_type: 'influencer', subscription_id: 'sub-1', gateway: 'paypal', gateway_payment_id: 'PAYPAL-SECRETO', payment_method: 'card', concept: 'Pro', amount: 5000, currency: 'CLP', status: 'completed', paid_at: '2026-10-01T00:00:00Z', period_start: null, period_end: null, receipt_url: 'https://interno/recibo' },
    { id: 'pay-2', influencer_id: 'inf-2', payer_type: 'influencer', subscription_id: 'sub-x', gateway: 'paypal', gateway_payment_id: 'OTRA', amount: 9999, currency: 'CLP', status: 'completed', paid_at: '2026-10-02T00:00:00Z' },
  ],
  campaign_influencers: [], campaigns: [], campaign_deliverables: [],
})
const as = (user: string | null) => { ;(globalThis as any).__routeHarness = { user: user ? { id: user, user_metadata: {} } : null, admin: makeAdmin(fresh(), { projectColumns: true }) } }
const me = await import('../src/app/api/influencer/me/route.ts')
const billing = await import('../src/app/api/influencer/billing/route.ts')
const SECRETS = ['org-secreta', 'I-SECRETO', 'PAYPAL-SECRETO', 'https://interno/recibo', 'paypal_internal', 'sub-1', 'canceled_at', 'gateway_payment_id', 'receipt_url', 'organization_id']

test('/me: sin sesión 401; devuelve la ficha propia SIN organization_id', async () => {
  as(null); assert.equal((await (me as any).GET()).status, 401)
  as('u1'); const r = await (me as any).GET(); assert.equal(r.status, 200)
  const body = await r.json()
  assert.equal(body.data.id, 'inf-1'); assert.equal(body.data.display_name, 'Ana'); assert.equal(body.data.email, 'a@x.cl')
  assert.equal('organization_id' in body.data, false)
  assert.ok(!JSON.stringify(body).includes('org-secreta'))
})
test('/me: solo la ficha del usuario de la sesión (u2 no recibe la de u1)', async () => {
  as('u2'); const body = await (await (me as any).GET()).json(); assert.equal(body.data.id, 'inf-2')
})
test('/billing: sin sesión 401; usuario sin ficha 403', async () => {
  as(null); assert.equal((await (billing as any).GET()).status, 401)
  as('u-nadie'); assert.equal((await (billing as any).GET()).status, 403)
})
test('/billing: solo campos permitidos, sin identificadores internos ni pagos ajenos', async () => {
  as('u1'); const r = await (billing as any).GET(); assert.equal(r.status, 200)
  const body = await r.json()
  assert.deepEqual(Object.keys(body.subscription).sort(), ['current_period_end', 'plan', 'started_paying_at', 'status'])
  assert.deepEqual(Object.keys(body.subscription.plan).sort(), ['name', 'tier'])
  assert.equal(body.payments.length, 1)
  assert.deepEqual(Object.keys(body.payments[0]).sort(), ['amount', 'currency', 'gateway', 'id', 'paid_at', 'period_end', 'period_start', 'status'])
  assert.equal(body.is_pro, true); assert.equal(body.total_paid, 5000)
  const text = JSON.stringify(body); for (const s of SECRETS) assert.ok(!text.includes(s), `filtra ${s}`)
  assert.ok(!text.includes('OTRA') && !text.includes('9999'))
})
