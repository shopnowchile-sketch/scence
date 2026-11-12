// Consultas en tandas paralelas (mismo resultado que el recorrido en serie) y dashboard/listado sin lecturas repetidas.
// Base en memoria; sin red ni producción. LÍMITE: no mide latencia real (ver docs/audits/optimizacion_y_guardados_2026-11-12.md).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'

register('./support/ts-resolve.mjs', import.meta.url)
register('./support/route-harness.mjs', import.meta.url)
const { makeAdmin } = await import('./support/memory-supabase.ts')
const { mapInBatches } = await import('../src/lib/supabase/fetchAllRows.ts')
const { resolveLastSeen } = await import('../src/lib/supabase/lastSeen.ts')
const { getInfluencerProStatuses, getInfluencerProSubscriptionDetails } = await import('../src/lib/influencer-pro.ts')

type Row = Record<string, any>
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('mapInBatches: tandas del tamaño pedido, resultados en orden y nunca más de `concurrency` a la vez', async () => {
  const items = Array.from({ length: 23 }, (_, i) => i)
  let inflight = 0, max = 0
  const out = await mapInBatches(items, 5, async batch => {
    inflight++; max = Math.max(max, inflight)
    await new Promise(r => setTimeout(r, 5 + (batch[0] % 3)))
    inflight--
    return batch
  }, 3)
  assert.equal(out.length, 5) // 5+5+5+5+3
  assert.deepEqual(out.flat(), items)
  assert.ok(max <= 3 && max > 1, `concurrencia ${max}`)
  assert.deepEqual(await mapInBatches([], 5, async b => b), [])
})

test('getInfluencerProStatuses: con varias tandas da el mismo resultado (manual, paid, free)', async () => {
  const ids = Array.from({ length: 650 }, (_, i) => `inf-${i}`)
  const db: Record<string, Row[]> = {
    influencers: ids.map((id, i) => ({ id, metadata: i === 10 || i === 450 ? { manual_pro: { active: true } } : {} })),
    subscriptions: [
      { status: 'active', current_period_end: null, metadata: { influencer_id: 'inf-5' } },
      { status: 'active', current_period_end: null, metadata: { influencer_id: 'inf-640' } },
      { status: 'incomplete', current_period_end: null, metadata: { influencer_id: 'inf-7' } },
    ],
  }
  const statuses = await getInfluencerProStatuses(makeAdmin(db), ids)
  assert.equal(statuses.size, 650)
  assert.equal(statuses.get('inf-5'), 'paid'); assert.equal(statuses.get('inf-640'), 'paid')
  assert.equal(statuses.get('inf-10'), 'manual'); assert.equal(statuses.get('inf-450'), 'manual')
  assert.equal(statuses.get('inf-7'), 'free'); assert.equal(statuses.get('inf-0'), 'free')
  assert.equal([...statuses.values()].filter(v => v !== 'free').length, 4)
})

test('getInfluencerProSubscriptionDetails: la que renueva gana y se resuelve en todas las tandas', async () => {
  const ids = Array.from({ length: 450 }, (_, i) => `inf-${i}`)
  const db: Record<string, Row[]> = {
    subscriptions: [
      { status: 'active', current_period_end: '2027-01-01T00:00:00Z', metadata: { influencer_id: 'inf-3' } },
      { status: 'active', current_period_end: '2027-02-01T00:00:00Z', metadata: { influencer_id: 'inf-430' } },
    ],
  }
  const details = await getInfluencerProSubscriptionDetails(makeAdmin(db), ids)
  assert.equal(details.size, 2)
  assert.equal(details.get('inf-430')?.pro_until, '2027-02-01T00:00:00Z')
  assert.equal(details.get('inf-3')?.renews, true)
})

test('resolveLastSeen: profiles.last_seen_at primero y auth.users como respaldo, en todas las tandas', async () => {
  const users = Array.from({ length: 450 }, (_, i) => `u-${i}`)
  const db: Record<string, Row[]> = {
    profiles: users.map((id, i) => ({ id, last_seen_at: i % 3 === 0 ? null : '2026-11-01T00:00:00Z' })),
  }
  const admin = makeAdmin(db) as any
  admin.auth = { admin: { listUsers: async ({ page }: { page: number }) => ({
    data: { users: page === 1 ? users.map(id => ({ id, last_sign_in_at: '2026-10-01T00:00:00Z' })) : [] }, error: null,
  }) } }
  const map = await resolveLastSeen(admin, users)
  assert.equal(map['u-1'], '2026-11-01T00:00:00Z')      // heartbeat real
  assert.equal(map['u-0'], '2026-10-01T00:00:00Z')      // respaldo auth.users (primera tanda)
  assert.equal(map['u-447'], '2026-10-01T00:00:00Z')    // respaldo en la última tanda
  assert.equal(Object.keys(map).length, 450)
})

test('dashboard: el roster se lee UNA vez (id, user_id) y Pro/cobros se lanzan en el Promise.all inicial', () => {
  const dash = read('src/app/api/dashboard/route.ts')
  assert.equal((dash.match(/from\('influencers'\)\s*\n?\s*\.select\('id, user_id'\)/g) ?? []).length, 1)
  assert.doesNotMatch(dash, /allInfluencerIds/)
  assert.doesNotMatch(dash, /influencersWithAccountRes/)
  assert.match(dash, /proSubscriptionsRes,\s*completedProPaymentsRes,\s*\] = await Promise\.all/)
  assert.match(dash, /\[influencerLastSeenMap, liveProfilesRes, proStatuses\] = await Promise\.all/)
})

test('GET /api/influencers: el enriquecimiento de la página se resuelve en un único Promise.all', () => {
  const route = read('src/app/api/influencers/route.ts')
  assert.match(route, /\[lastSeenMap, biRes, orgBrandRes, proStatuses, proSubscriptions\] = await Promise\.all/)
  assert.equal((route.match(/getInfluencerProSubscriptionDetails\(admin/g) ?? []).length, 1)
})

test('GET /api/campaigns?summary=1: el KPI de pendientes usa la misma fuente única (type + attendance_response)', () => {
  const route = read('src/app/api/campaigns/route.ts')
  assert.match(route, /\.select\('campaign_id, type, status, attendance_response, content_url, published_url, campaign_influencers!inner\(application_status\)'\)/)
})

test('dashboard (handler real, base en memoria): "han ingresado" y embudo Pro con roster en varias tandas', async () => {
  const users = Array.from({ length: 450 }, (_, i) => `u-${i}`)
  const influencers = Array.from({ length: 500 }, (_, i) => ({
    id: `inf-${i}`, organization_id: 'org', user_id: i < 450 ? `u-${i}` : null, is_active: true,
    metadata: i === 3 ? { manual_pro: { active: true } } : {},
  }))
  const db: Record<string, Row[]> = {
    organization_members: [{ id: 'm', user_id: 'adm', organization_id: 'org', role: 'super_admin', is_active: true }],
    influencers,
    profiles: users.map((id, i) => ({ id, last_seen_at: i % 2 ? '2026-11-01T00:00:00Z' : null })),
    subscriptions: [
      { id: 's1', organization_id: 'org', status: 'active', created_at: '2026-10-01', metadata: { account_type: 'influencer', influencer_id: 'inf-9' } },
      { id: 's2', organization_id: 'org', status: 'incomplete', created_at: '2026-10-02', metadata: { account_type: 'influencer', influencer_id: 'inf-20' } },
    ],
    subscription_payments: [{ organization_id: 'org', payer_type: 'influencer', status: 'completed', subscription_id: 's1', influencer_id: 'inf-9' }],
    campaigns: [], campaign_influencers: [], campaign_deliverables: [], brands: [], invoices: [], payroll_runs: [],
  }
  const admin = makeAdmin(db) as any
  admin.auth = { admin: { listUsers: async () => ({ data: { users: users.map(id => ({ id, last_sign_in_at: null })) }, error: null }) } }
  ;(globalThis as any).__routeHarness = { user: { id: 'adm', user_metadata: {} }, admin }
  const dashboard = await import('../src/app/api/dashboard/route.ts')
  const res = await (dashboard as any).GET()
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.deepEqual(body.influencer_portal, { entered: 225, pending: 275 })
  assert.equal(body.kpis.total_influencers, 500)
  assert.equal(body.pro_plan.active, 2)   // inf-9 pagada + inf-3 manual
  assert.equal(body.pro_plan.paid, 1)
  assert.equal(body.pro_plan.manual, 1)
  assert.equal(body.pro_plan.attempts, 1) // inf-20 intentó y sigue Gratis
  assert.equal(body.pro_plan.paid_influencers, 1)
})
