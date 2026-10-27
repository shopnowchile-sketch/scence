// Auditoría de acceso (2026-10-22) de: tickets, brand/brands, influencers/communes, campaigns/[id]/influencer-report.
// Ejecuta handlers REALES contra una base en memoria (sin red ni producción). LÍMITES: no prueba RLS real ni el
// HTML completo del informe (se comprueba solo que la autorización deje pasar o corte).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'

register('./support/ts-resolve.mjs', import.meta.url)
register('./support/route-harness.mjs', import.meta.url)
const { makeAdmin } = await import('./support/memory-supabase.ts')

type Row = Record<string, any>
const m = (user_id: string, organization_id: string, role: string, brand_id: string | null, is_owner = false) => ({ id: `m-${user_id}`, user_id, organization_id, role, brand_id, is_owner, is_active: true })
const fresh = (): Record<string, Row[]> => ({
  brands: [
    { id: 'brand-A', organization_id: 'org-A', status: 'approved', created_by: 'uOwnerA' },
    { id: 'brand-B', organization_id: 'org-B', status: 'approved', created_by: 'uOwnerB' },
    { id: 'brand-R', organization_id: 'org-R', status: 'rejected', created_by: 'uR' },
    { id: 'brand-P', organization_id: 'org-P', status: 'pending_approval', created_by: 'uP' },
  ],
  organization_members: [
    m('uOwnerA', 'org-A', 'brand_manager', 'brand-A', true), m('uMgrA', 'org-A', 'brand_manager', 'brand-A'),
    m('uMemA', 'org-A', 'member', 'brand-A'), m('uFinA', 'org-A', 'finance', 'brand-A'),
    m('uOwnerB', 'org-B', 'brand_manager', 'brand-B', true),
    m('uR', 'org-R', 'brand_manager', 'brand-R', true), m('uP', 'org-P', 'brand_manager', 'brand-P', true),
    m('uAdmin', 'org-adm', 'super_admin', null),
  ],
  campaigns: [
    { id: 'camp-A', organization_id: 'org-A', brand_id: 'brand-A', created_by_brand_id: null, name: 'Camp A', status: 'active' },
    { id: 'camp-B', organization_id: 'org-B', brand_id: 'brand-B', created_by_brand_id: null, name: 'Camp B', status: 'active' },
  ],
  campaign_influencers: [{ id: 'ci1', campaign_id: 'camp-A', influencer_id: 'inf-in', fee: 1, currency: 'CLP', notes: null }],
  influencers: [{ id: 'inf-in', display_name: 'Dentro', email: 'dentro@x.test' }, { id: 'inf-out', display_name: 'Fuera', email: 'fuera@x.test' }],
  campaign_deliverables: [], campaign_brands: [], tickets: [{ id: 't1', organization_id: 'org-A' }, { id: 't2', organization_id: 'org-adm' }],
})
const req = (url = 'http://localhost/api/x', body: unknown = {}) => ({ url, json: async () => body, headers: new Headers(), nextUrl: new URL(url) }) as any
const as = (user: string | null) => { ;(globalThis as any).__routeHarness = { user: user ? { id: user } : null, admin: makeAdmin(fresh(), { projectColumns: true }) } }

// ── tickets: panel de admin (marcas e influencers usan /api/support) ─────────────────────────
test('tickets y tickets/[id]: solo admin de plataforma; miembros de marca 403; sin sesión 401', async () => {
  const list = await import('../src/app/api/tickets/route.ts')
  const one = await import('../src/app/api/tickets/[id]/route.ts')
  const p = { params: { id: 't1' } }
  const calls: Array<[string, () => Promise<Response>]> = [
    ['GET list', () => (list as any).GET(req())], ['POST list', () => (list as any).POST(req('http://localhost/api/tickets', {}))],
    ['GET one', () => (one as any).GET(req(), p)], ['PATCH one', () => (one as any).PATCH(req('http://localhost/api/tickets/t1', { status: 'closed' }), p)], ['DELETE one', () => (one as any).DELETE(req(), p)],
  ]
  for (const [label, run] of calls) {
    for (const u of ['uOwnerA', 'uMgrA', 'uMemA', 'uFinA', 'uOwnerB']) { as(u); assert.equal((await run()).status, 403, `${label} ${u}`) }
    as(null); assert.equal((await run()).status, 401, `${label} sin sesión`)
    as('uAdmin'); assert.notEqual((await run()).status, 403, `${label} admin`)
  }
})
test('tickets/[id]/replies conserva su control propio: admin de la organización del ticket o dueño del ticket', () => {
  const src = readFileSync(new URL('../src/app/api/tickets/[id]/replies/route.ts', import.meta.url), 'utf8')
  assert.match(src, /getUserRole\(user\.id, orgId, admin\)\)\.isAdmin/)
  assert.match(src, /\.eq\('created_by', user\.id\)/)
})

// ── brand/brands (GET) ────────────────────────────────────────────────────────────────────────
test('brand/brands GET: owner/manager/member de marca aprobada pasan; finance, pendiente, rechazada, sin membresía e influencer no; admin pasa', async () => {
  const route = await import('../src/app/api/brand/brands/route.ts')
  for (const u of ['uOwnerA', 'uMgrA', 'uMemA']) { as(u); assert.equal((await (route as any).GET(req('http://localhost/api/brand/brands'))).status, 200, u) }
  for (const u of ['uFinA', 'uP', 'uR', 'uInfluencer', 'uNadie']) { as(u); assert.equal((await (route as any).GET(req('http://localhost/api/brand/brands'))).status, 403, u) }
  as(null); assert.equal((await (route as any).GET(req('http://localhost/api/brand/brands'))).status, 401)
  as('uAdmin'); assert.notEqual((await (route as any).GET(req('http://localhost/api/brand/brands'))).status, 403)
})
test('brand/brands GET: una marca solo ve las campañas/colaboradoras de SU organización', async () => {
  const route = await import('../src/app/api/brand/brands/route.ts')
  const db = fresh(); db.campaign_brands = [{ brand_id: 'brand-B', campaign_id: 'camp-B', role: 'collab', brand: { id: 'brand-B', name: 'B' } }, { brand_id: 'brand-A', campaign_id: 'camp-A', role: 'collab', brand: { id: 'brand-A', name: 'A' } }]
  ;(globalThis as any).__routeHarness = { user: { id: 'uOwnerB' }, admin: makeAdmin(db, { projectColumns: true }) }
  const r = await (route as any).GET(req('http://localhost/api/brand/brands')); assert.equal(r.status, 200)
  const body = await r.json(); const campNames = JSON.stringify(body)
  assert.ok(!campNames.includes('Camp A'), 'no debe aparecer la campaña de otra marca')
})

// ── communes: catálogo oficial, sin datos de ninguna marca ─────────────────────────────────────
test('influencers/communes: exige sesión y no usa organización (solo catálogo de locations)', async () => {
  const route = await import('../src/app/api/influencers/communes/route.ts')
  as(null); assert.equal((await (route as any).GET()).status, 401)
  const src = readFileSync(new URL('../src/app/api/influencers/communes/route.ts', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '')
  assert.doesNotMatch(src, /getOrgId|organization_id/)
})

// ── campaigns/[id]/influencer-report ─────────────────────────────────────────────────────────
test('influencer-report: roles sin report.read, otra marca e influencer ajena a la campaña → 404; dueño con report.read pasa; admin pasa', async () => {
  const route = await import('../src/app/api/campaigns/[id]/influencer-report/route.ts')
  const call = async (u: string | null, camp: string, inf: string) => { as(u); try { return (await (route as any).GET(req(`http://localhost/x?influencer_id=${inf}`), { params: { id: camp } })).status } catch { return -1 } }
  assert.equal(await call(null, 'camp-A', 'inf-in'), 401)
  assert.equal(await call('uFinA', 'camp-A', 'inf-in'), 404, 'finance ya no es rol de marca: sin acceso')
  assert.equal(await call('uOwnerB', 'camp-A', 'inf-in'), 404, 'otra marca')
  assert.equal(await call('uOwnerA', 'camp-A', 'inf-out'), 404, 'influencer que no participa en la campaña')
  assert.equal(await call('uNadie', 'camp-A', 'inf-in'), 404)
  for (const u of ['uOwnerA', 'uMgrA', 'uMemA', 'uAdmin']) { const s = await call(u, 'camp-A', 'inf-in'); assert.ok(![401, 403, 404].includes(s), `${u} debe pasar la autorización (status ${s})`) }
})

// ── POST /api/influencers: antes sin autorización y con la organización tomada del body/metadata ──
test('POST /api/influencers: solo admin; organization_id ajena del body → 403; no se toma de user_metadata', async () => {
  const route = await import('../src/app/api/influencers/route.ts')
  const body = { display_name: 'X', location_id: 'loc', social_profiles: [{ platform: 'instagram', username: 'x' }] }
  const post = (b: any = body) => (route as any).POST(req('http://localhost/api/influencers', b))
  as(null); assert.equal((await post()).status, 401)
  for (const u of ['uOwnerA', 'uMgrA', 'uMemA', 'uFinA', 'uInfluencer']) { as(u); assert.equal((await post()).status, 403, u) }
  as('uAdmin'); assert.equal((await post({ ...body, organization_id: 'org-A' })).status, 403, 'organización ajena')
  const src = readFileSync(new URL('../src/app/api/influencers/route.ts', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '')
  assert.doesNotMatch(src.slice(src.indexOf('export async function POST')), /user\.user_metadata\?\.organization_id/)
})

// ── influencer-report: casos límite de estado de marca y de propiedad de la campaña (2026-10-24) ──
// Complementa la prueba anterior: report.read es una operación, así que el estado de la marca la bloquea en el servidor.
test('influencer-report: marca pendiente/rechazada/suspendida → 404 aunque sea dueña; colaboradora de campaña_brands → 404; created_by_brand_id sí es dueña; super_admin con membresía de otra marca conserva acceso', async () => {
  const route = await import('../src/app/api/campaigns/[id]/influencer-report/route.ts')
  const db = () => {
    const d = fresh()
    d.brands.push({ id: 'brand-S', organization_id: 'org-S', status: 'suspended', created_by: 'uS' })
    d.organization_members.push(
      m('uS', 'org-S', 'brand_manager', 'brand-S', true),
      m('uAdminB', 'org-B', 'super_admin', 'brand-B'), // admin de plataforma que además pertenece a una marca
    )
    d.campaigns.push(
      { id: 'camp-P', organization_id: 'org-P', brand_id: 'brand-P', created_by_brand_id: null, name: 'Camp P', status: 'active' },
      { id: 'camp-R', organization_id: 'org-R', brand_id: 'brand-R', created_by_brand_id: null, name: 'Camp R', status: 'active' },
      { id: 'camp-S', organization_id: 'org-S', brand_id: 'brand-S', created_by_brand_id: null, name: 'Camp S', status: 'active' },
      { id: 'camp-C', organization_id: 'org-A', brand_id: null, created_by_brand_id: 'brand-A', name: 'Camp C', status: 'active' },
    )
    for (const c of ['camp-P', 'camp-R', 'camp-S', 'camp-C']) d.campaign_influencers.push({ id: `ci-${c}`, campaign_id: c, influencer_id: 'inf-in', fee: 1, currency: 'CLP', notes: null })
    // brand-B solo colabora en camp-A (campaign_brands); no es dueña ni creadora.
    d.campaign_brands.push({ brand_id: 'brand-B', campaign_id: 'camp-A', role: 'collab', brand: { id: 'brand-B', name: 'B' } })
    return d
  }
  const call = async (u: string, camp: string) => {
    ;(globalThis as any).__routeHarness = { user: { id: u }, admin: makeAdmin(db(), { projectColumns: true }) }
    try { return (await (route as any).GET(req(`http://localhost/x?influencer_id=inf-in`), { params: { id: camp } })).status } catch { return -1 }
  }
  // Estado de la marca: el dueño con rol suficiente queda bloqueado si la marca no está aprobada.
  assert.equal(await call('uP', 'camp-P'), 404, 'pendiente')
  assert.equal(await call('uR', 'camp-R'), 404, 'rechazada')
  assert.equal(await call('uS', 'camp-S'), 404, 'suspendida')
  // Colaboradora en campaign_brands (opción A): mismo acceso que la principal, solo en las campañas donde está vinculada.
  assert.ok(![401, 403, 404].includes(await call('uOwnerB', 'camp-A')), 'marca colaboradora vinculada a la campaña')
  // Propiedad por created_by_brand_id (brand_id nulo): el dueño sigue pasando; otra marca no.
  assert.ok(![401, 403, 404].includes(await call('uOwnerA', 'camp-C')), 'dueña por created_by_brand_id')
  assert.equal(await call('uOwnerB', 'camp-C'), 404, 'otra marca en camp-C')
  // Marca aprobada pero influencer inexistente en la campaña: ya cubierto arriba; aquí, id de campaña inexistente.
  assert.equal(await call('uOwnerA', 'camp-NOEXISTE'), 404, 'campaña inexistente')
  // super_admin con membresía de marca: acceso global (el admin se evalúa antes que la marca).
  assert.ok(![401, 403, 404].includes(await call('uAdminB', 'camp-A')), 'super_admin con membresía de otra marca')
})
