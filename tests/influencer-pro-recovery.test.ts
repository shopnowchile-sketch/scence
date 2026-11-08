// Recuperación de inscripciones Pro pendientes (2026-11-07): la influencer aprobó en PayPal pero
// perdió la sesión o cambió de navegador. SCENCE debe sincronizarla sin crear una segunda
// suscripción (doble cobro). PayPal está simulado: solo se hacen GET; estas pruebas no tocan red.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'

register('./support/ts-resolve.mjs', import.meta.url)
const { reconcileInfluencerProSubscriptions, recordProCheckout } = await import('../src/lib/influencer-pro-recovery.ts')
const { safeInternalPath } = await import('../src/lib/safe-redirect.ts')

const NOW = new Date('2026-11-07T12:00:00Z')
const influencer = { id: 'inf-1', organization_id: 'org-1', user_id: 'user-1' }

type Row = Record<string, any>
function fakeAdmin(rows: Row[], opts: { updateError?: boolean; insertError?: { code: string; message: string } } = {}) {
  const updates: Row[] = []
  const inserts: Row[] = []
  const admin: any = {
    from(table: string) {
      if (table === 'subscription_plans') {
        const b: any = { select: () => b, eq: () => b, maybeSingle: async () => ({ data: { id: 'plan-pro' }, error: null }) }
        return b
      }
      const q: any = {
        select: () => q, eq: () => q, not: () => q, filter: () => q, order: () => q, limit: () => q,
        then: (resolve: any) => resolve({ data: rows, error: null }),
        update: (values: Row) => ({ eq: async () => { updates.push(values); return { error: opts.updateError ? { message: 'boom' } : null } } }),
        insert: async (values: Row) => { inserts.push(values); return { error: opts.insertError ?? null } },
        maybeSingle: async () => ({ data: null, error: null }),
      }
      return q
    },
  }
  return { admin, updates, inserts }
}

const pending = (id: string, extra: Row = {}) => ({ id: `row-${id}`, status: 'incomplete', metadata: { influencer_id: 'inf-1' }, current_period_end: null, canceled_at: null, paypal_subscription_id: id, created_at: '2026-11-07T11:00:00Z', ...extra })
const lookupOf = (table: Record<string, { status?: number; body?: any }>) => async (id: string) => {
  const entry = table[id] ?? { status: 404 }
  const status = entry.status ?? 200
  return { ok: status >= 200 && status < 300, status, body: entry.body ?? null }
}
const paypalActive = { status: 'ACTIVE', custom_id: 'influencer:inf-1', start_time: '2026-11-07T11:30:00Z', billing_info: { next_billing_time: '2026-12-07T11:30:00Z' } }

test('sin intentos pendientes: none y no llama a PayPal', async () => {
  const { admin } = fakeAdmin([])
  let calls = 0
  const result = await reconcileInfluencerProSubscriptions(admin, influencer, { lookup: async () => { calls++; return { ok: true, status: 200, body: null } }, now: NOW })
  assert.equal(result.state, 'none')
  assert.equal(calls, 0)
})

test('PayPal ya tiene ACTIVE: se sincroniza la fila (Pro) sin crear nada nuevo', async () => {
  const { admin, updates, inserts } = fakeAdmin([pending('I-1')])
  const result = await reconcileInfluencerProSubscriptions(admin, influencer, { lookup: lookupOf({ 'I-1': { body: paypalActive } }), now: NOW })
  assert.equal(result.state, 'active')
  assert.equal(updates.length, 1)
  assert.equal(updates[0].status, 'active')
  assert.equal(inserts.length, 0)
})

test('dos ACTIVE para la misma influencer: se avisa duplicado y no se abre otra', async () => {
  const { admin } = fakeAdmin([pending('I-1'), pending('I-2')])
  const result = await reconcileInfluencerProSubscriptions(admin, influencer, { lookup: lookupOf({ 'I-1': { body: paypalActive }, 'I-2': { body: paypalActive } }), now: NOW })
  assert.equal(result.state, 'active')
  assert.equal((result as { duplicateActive: number }).duplicateActive, 1)
})

test('APPROVED (PayPal aún activando): processing, bloquea nuevo checkout', async () => {
  const { admin, updates } = fakeAdmin([pending('I-1')])
  const result = await reconcileInfluencerProSubscriptions(admin, influencer, { lookup: lookupOf({ 'I-1': { body: { status: 'APPROVED', custom_id: 'influencer:inf-1' } } }), now: NOW })
  assert.equal(result.state, 'processing')
  assert.equal(updates.length, 0)
})

test('APPROVAL_PENDING reciente con enlace: se reutiliza', async () => {
  const { admin } = fakeAdmin([pending('I-1')])
  const body = { status: 'APPROVAL_PENDING', custom_id: 'influencer:inf-1', create_time: '2026-11-07T11:00:00Z', links: [{ rel: 'approve', href: 'https://paypal.test/approve' }] }
  const result = await reconcileInfluencerProSubscriptions(admin, influencer, { lookup: lookupOf({ 'I-1': { body } }), now: NOW })
  assert.deepEqual(result, { state: 'pending', paypalSubscriptionId: 'I-1', approveUrl: 'https://paypal.test/approve' })
})

test('APPROVAL_PENDING de hace más de 24 h: no se reutiliza', async () => {
  const { admin } = fakeAdmin([pending('I-1')])
  const body = { status: 'APPROVAL_PENDING', custom_id: 'influencer:inf-1', create_time: '2026-11-05T11:00:00Z', links: [{ rel: 'approve', href: 'https://paypal.test/approve' }] }
  const result = await reconcileInfluencerProSubscriptions(admin, influencer, { lookup: lookupOf({ 'I-1': { body } }), now: NOW })
  assert.equal(result.state, 'none')
})

test('custom_id de otra influencer: se ignora (no se activa ajena)', async () => {
  const { admin, updates } = fakeAdmin([pending('I-1')])
  const result = await reconcileInfluencerProSubscriptions(admin, influencer, { lookup: lookupOf({ 'I-1': { body: { ...paypalActive, custom_id: 'influencer:otra' } } }), now: NOW })
  assert.equal(result.state, 'none')
  assert.equal(updates.length, 0)
})

test('404 en PayPal: se ignora; error 500: falla cerrado (unavailable)', async () => {
  const a = fakeAdmin([pending('I-1')])
  assert.equal((await reconcileInfluencerProSubscriptions(a.admin, influencer, { lookup: lookupOf({}), now: NOW })).state, 'none')
  const b = fakeAdmin([pending('I-1')])
  assert.equal((await reconcileInfluencerProSubscriptions(b.admin, influencer, { lookup: lookupOf({ 'I-1': { status: 500 } }), now: NOW })).state, 'unavailable')
})

test('si falla el UPDATE de la fila activa: unavailable (no se declara Pro a medias)', async () => {
  const { admin } = fakeAdmin([pending('I-1')], { updateError: true })
  const result = await reconcileInfluencerProSubscriptions(admin, influencer, { lookup: lookupOf({ 'I-1': { body: paypalActive } }), now: NOW })
  assert.equal(result.state, 'unavailable')
})

test('recordProCheckout guarda el intento incomplete con el contexto del navegador', async () => {
  const { admin, inserts } = fakeAdmin([])
  const result = await recordProCheckout(admin, { influencer, paypalSubscriptionId: 'I-9', campaignId: null, context: { in_app_browser: true, return_campaign_id: null }, now: NOW })
  assert.equal(result.ok, true)
  assert.equal(inserts[0].status, 'incomplete')
  assert.equal(inserts[0].paypal_subscription_id, 'I-9')
  assert.equal(inserts[0].metadata.checkout.in_app_browser, true)
})

test('recordProCheckout: un fallo no lanza (el pago no se bloquea)', async () => {
  const { admin } = fakeAdmin([], { insertError: { code: 'XX000', message: 'boom' } })
  const result = await recordProCheckout(admin, { influencer, paypalSubscriptionId: 'I-9', campaignId: null, context: { in_app_browser: false, return_campaign_id: null }, now: NOW })
  assert.equal(result.ok, false)
})

// ── redirecciones seguras ──────────────────────────────────────────────────

test('safeInternalPath solo acepta rutas internas', () => {
  assert.equal(safeInternalPath('/inf-profile?tab=plan&subscription_id=I-1'), '/inf-profile?tab=plan&subscription_id=I-1')
  for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', 'javascript:alert(1)', '/a\nb', '', null, undefined]) {
    assert.equal(safeInternalPath(bad as string | null | undefined, '/x'), '/x', String(bad))
  }
})

// ── guardias estáticas del recorrido ───────────────────────────────────────

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('middleware conserva la query en el redirect a login', () => {
  assert.match(read('src/middleware.ts'), /request\.nextUrl\.search/)
})
test('login de influencer vuelve a /inf-* y usa el redirect validado', () => {
  const src = read('src/app/(auth)/login/LoginForm.tsx')
  assert.match(src, /safeInternalPath\(searchParams\.get\('redirect'\)/)
  assert.match(src, /redirect\.startsWith\('\/inf-'\)/)
})
test('/auth/confirm: el GET no consume el token; solo el POST llama verifyOtp; next validado', () => {
  const src = read('src/app/auth/confirm/route.ts')
  const get = src.slice(src.indexOf('export async function GET'), src.indexOf('export async function POST'))
  assert.doesNotMatch(get, /verifyOtp/)
  assert.match(src.slice(src.indexOf('export async function POST')), /verifyOtp/)
  assert.match(src, /safeInternalPath/)
})
test('checkout revisa intentos previos antes de crear la suscripción en PayPal', () => {
  const src = read('src/app/api/influencer/paypal/checkout/route.ts')
  assert.ok(src.indexOf('reconcileInfluencerProSubscriptions(') < src.indexOf('/v1/billing/subscriptions`'))
})

test('la revisión cubre hasta 25 intentos pendientes por influencer (antes 8)', () => {
  assert.match(read('src/lib/influencer-pro-recovery.ts'), /MAX_ATTEMPTS_CHECKED = 25/)
})
