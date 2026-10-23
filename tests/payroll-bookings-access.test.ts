// Acceso a payroll y bookings (política APROBADA 2026-10-22). Base en memoria, sin red ni producción.
//   payroll GET/POST/PATCH ........ solo admin de plataforma (`finance` de marca NO)
//   bookings GET (agenda global) .. solo admin de plataforma
//   bookings POST/PUT/DELETE ...... admin, o marca con `campaign.manage` sobre una campaña SUYA con marca operativa
//                                   (owner y brand_manager sí; member y finance no; sin campaña → solo admin)
// LÍMITES: no prueba RLS real ni Google Calendar (sus fallos son no fatales en la ruta).
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('./support/ts-resolve.mjs', import.meta.url)
register('./support/route-harness.mjs', import.meta.url)
const { makeAdmin } = await import('./support/memory-supabase.ts')

type Row = Record<string, any>
const m = (user_id: string, organization_id: string, role: string, brand_id: string | null, is_owner = false) => ({ id: `m-${user_id}`, user_id, organization_id, role, brand_id, is_owner, is_active: true })
const fresh = (): Record<string, Row[]> => ({
  brands: [
    { id: 'brand-A', organization_id: 'org-A', status: 'approved' },
    { id: 'brand-B', organization_id: 'org-B', status: 'approved' },
    { id: 'brand-P', organization_id: 'org-P', status: 'pending_approval' },
  ],
  organization_members: [
    m('uOwnerA', 'org-A', 'brand_manager', 'brand-A', true), m('uMgrA', 'org-A', 'brand_manager', 'brand-A'),
    m('uMemA', 'org-A', 'member', 'brand-A'), m('uFinA', 'org-A', 'finance', 'brand-A'),
    m('uMgrB', 'org-B', 'brand_manager', 'brand-B'), m('uMgrP', 'org-P', 'brand_manager', 'brand-P'),
    m('uAdmin', 'org-adm', 'super_admin', null),
    // Administrador de plataforma que además es miembro de la marca A (no dueño)
    m('uDual', 'org-adm', 'super_admin', null), { ...m('uDual', 'org-A', 'brand_manager', 'brand-A'), id: 'm-uDual-brand' },
    // Ex-administrador (membresía super_admin INACTIVA) y miembro de la marca A
    { ...m('uExAdmin', 'org-adm', 'super_admin', null), is_active: false }, { ...m('uExAdmin', 'org-A', 'brand_manager', 'brand-A'), id: 'm-uExAdmin-brand' },
  ],
  campaigns: [
    { id: 'camp-A', organization_id: 'org-A', brand_id: 'brand-A', created_by_brand_id: null },
    { id: 'camp-B', organization_id: 'org-B', brand_id: 'brand-B', created_by_brand_id: null },
    { id: 'camp-P', organization_id: 'org-P', brand_id: 'brand-P', created_by_brand_id: null },
  ],
  bookings: [
    { id: 'bk-A', organization_id: 'org-A', campaign_id: 'camp-A', status: 'confirmed', starts_at: '2026-11-01T10:00:00Z', calendar_event_id: null },
    { id: 'bk-B', organization_id: 'org-B', campaign_id: 'camp-B', status: 'confirmed', starts_at: '2026-11-02T10:00:00Z', calendar_event_id: null },
    { id: 'bk-P', organization_id: 'org-P', campaign_id: 'camp-P', status: 'confirmed', starts_at: '2026-11-03T10:00:00Z', calendar_event_id: null },
    { id: 'bk-adm', organization_id: 'org-adm', campaign_id: null, status: 'confirmed', starts_at: '2026-11-04T10:00:00Z', calendar_event_id: null },
    { id: 'bk-A-free', organization_id: 'org-A', campaign_id: null, status: 'confirmed', starts_at: '2026-11-05T10:00:00Z', calendar_event_id: null },
  ],
  booking_influencers: [], influencers: [],
  payroll_runs: [{ id: 'pr-A', organization_id: 'org-A', status: 'draft' }, { id: 'pr-adm', organization_id: 'org-adm', status: 'draft' }], payroll_items: [],
})
const req = (url: string, body: unknown = {}) => ({ url, json: async () => body, headers: new Headers(), nextUrl: new URL(url) }) as any
const as = (user: string | null, db = fresh()) => { ;(globalThis as any).__routeHarness = { user: user ? { id: user } : null, admin: makeAdmin(db, { projectColumns: true }) }; return db }
const status = async (fn: () => Promise<Response>) => { try { return (await fn()).status } catch { return 'AUTORIZADO_Y_FALLO_DESPUES' as const } }

const bookings = await import('../src/app/api/bookings/route.ts')
const payroll = await import('../src/app/api/payroll/route.ts')
const bGet = () => (bookings as any).GET(req('http://localhost/api/bookings'))
const bDel = (id: string) => (bookings as any).DELETE(req(`http://localhost/api/bookings?id=${id}`))
const bPut = (body: Row) => (bookings as any).PUT(req('http://localhost/api/bookings', body))
const bPost = (body: Row) => (bookings as any).POST(req('http://localhost/api/bookings', { title: 't', starts_at: '2026-12-01T10:00:00Z', ends_at: '2026-12-01T11:00:00Z', ...body }))
const pGet = () => (payroll as any).GET(req('http://localhost/api/payroll'))
const pPost = () => (payroll as any).POST(req('http://localhost/api/payroll', { name: 'n', organization_id: 'org-A' }))
const pPatch = (run = 'pr-A') => (payroll as any).PATCH(req('http://localhost/api/payroll', { run_id: run, action: 'approve' }))
const DENIED = [403]
const ALLOWED = (v: unknown) => v !== 401 && v !== 403 && v !== 404

test('payroll: sin sesión 401; owner, brand_manager, member y finance de marca → 403 en GET/POST/PATCH', async () => {
  as(null); assert.equal((await pGet()).status, 401)
  for (const u of ['uOwnerA', 'uMgrA', 'uMemA', 'uFinA', 'uMgrB']) {
    as(u)
    assert.equal((await pGet()).status, 403, `GET ${u}`)
    assert.equal((await pPost()).status, 403, `POST ${u}`)
    assert.equal((await pPatch()).status, 403, `PATCH ${u}`)
  }
})
test('payroll: admin de plataforma pasa la autorización', async () => {
  as('uAdmin'); assert.ok(ALLOWED(await status(pGet)))
  as('uAdmin'); assert.ok(ALLOWED(await status(pPost)))
  as('uAdmin'); assert.ok(ALLOWED(await status(() => pPatch('pr-adm'))))
})
test('bookings GET (agenda): sin sesión 401; ningún rol de marca → 403; admin 200 y solo su organización', async () => {
  as(null); assert.equal((await bGet()).status, 401)
  for (const u of ['uOwnerA', 'uMgrA', 'uMemA', 'uFinA', 'uMgrB', 'uMgrP']) { as(u); assert.equal((await bGet()).status, 403, u) }
  as('uAdmin'); const r = await bGet(); assert.equal(r.status, 200)
  assert.deepEqual(((await r.json()).data as Row[]).map(b => b.id), ['bk-adm'])
})
test('bookings escritura: owner y brand_manager de la marca dueña de la campaña pasan (DELETE y PUT)', async () => {
  for (const u of ['uOwnerA', 'uMgrA']) {
    as(u); assert.ok(ALLOWED(await status(() => bDel('bk-A'))), `DELETE ${u}`)
    as(u); assert.ok(ALLOWED(await status(() => bPut({ id: 'bk-A', title: 'x' }))), `PUT ${u}`)
  }
})
test('bookings escritura: member y finance de la marca → 403 en POST/PUT/DELETE', async () => {
  for (const u of ['uMemA', 'uFinA']) {
    as(u); assert.equal((await bDel('bk-A')).status, 403, `DELETE ${u}`)
    as(u); assert.equal((await bPut({ id: 'bk-A', title: 'x' })).status, 403, `PUT ${u}`)
    as(u); assert.equal((await bPost({ campaign_id: 'camp-A' })).status, 403, `POST ${u}`)
  }
})
test('bookings escritura: otra marca no toca campañas ni bookings ajenos (POST/PUT/DELETE → 403)', async () => {
  as('uMgrB')
  assert.equal((await bDel('bk-A')).status, 403)
  as('uMgrB'); assert.equal((await bPut({ id: 'bk-A', title: 'x' })).status, 403)
  as('uMgrB'); assert.equal((await bPost({ campaign_id: 'camp-A' })).status, 403)
})
test('bookings escritura: marca no operativa (pending_approval) → 403', async () => {
  as('uMgrP'); assert.equal((await bDel('bk-P')).status, 403)
  as('uMgrP'); assert.equal((await bPost({ campaign_id: 'camp-P' })).status, 403)
})
test('bookings escritura: sin campaña, ningún rol de marca puede (aunque sea su organización); admin sí en la suya', async () => {
  for (const u of ['uOwnerA', 'uMgrA']) {
    as(u); assert.equal((await bDel('bk-A-free')).status, 403, `DELETE ${u}`)
    as(u); assert.equal((await bPost({})).status, 403, `POST ${u}`)
  }
  as('uAdmin'); assert.ok(ALLOWED(await status(() => bDel('bk-adm'))))
  as('uAdmin'); assert.equal((await bDel('bk-A-free')).status, 403, 'admin no toca bookings sin campaña de otra organización')
})
test('bookings escritura: admin pasa con campañas de cualquier marca', async () => {
  for (const [c, b] of [['camp-A', 'bk-A'], ['camp-B', 'bk-B']] as const) {
    as('uAdmin'); assert.ok(ALLOWED(await status(() => bDel(b))), b)
    as('uAdmin'); assert.ok(ALLOWED(await status(() => bPost({ campaign_id: c }))), c)
  }
})
test('bookings PUT: no permite reasignar campaign_id ni organization_id', async () => {
  const db = as('uMgrA')
  await status(() => bPut({ id: 'bk-A', title: 'nuevo', campaign_id: 'camp-B', organization_id: 'org-B' }))
  const row = db.bookings.find(b => b.id === 'bk-A')!
  assert.equal(row.campaign_id, 'camp-A'); assert.equal(row.organization_id, 'org-A')
})
test('bookings: sin sesión 401 y booking inexistente 404', async () => {
  as(null); assert.equal((await bDel('bk-A')).status, 401)
  as('uMgrA'); assert.equal((await bDel('nope')).status, 404)
})

// ── Administrador de plataforma que también es miembro de una marca ─────────────────────────
test('admin + miembro de marca: conserva el acceso global (campaña de OTRA marca, payroll, agenda)', async () => {
  as('uDual'); assert.ok(ALLOWED(await status(() => bDel('bk-B'))), 'DELETE booking de otra marca')
  as('uDual'); assert.ok(ALLOWED(await status(() => bPost({ campaign_id: 'camp-B' }))), 'POST en campaña de otra marca')
  as('uDual'); assert.ok(ALLOWED(await status(() => bPut({ id: 'bk-B', title: 'x' }))), 'PUT booking de otra marca')
  as('uDual'); assert.equal((await bGet()).status, 200)
  as('uDual'); assert.ok(ALLOWED(await status(pGet)))
})
test('admin + miembro de marca: también opera la campaña de su propia marca y en marca no operativa', async () => {
  as('uDual'); assert.ok(ALLOWED(await status(() => bDel('bk-A'))))
  as('uDual'); assert.ok(ALLOWED(await status(() => bDel('bk-P'))), 'la suspensión/pendiente de una marca no limita a la plataforma')
})
test('NO amplía a otros: ex-administrador (super_admin inactivo) con marca queda limitado a su marca', async () => {
  as('uExAdmin'); assert.equal((await bGet()).status, 403)
  as('uExAdmin'); assert.equal((await pGet()).status, 403)
  as('uExAdmin'); assert.equal((await bDel('bk-B')).status, 403)
  as('uExAdmin'); assert.ok(ALLOWED(await status(() => bDel('bk-A'))), 'su propia marca sigue permitida')
})
test('NO amplía a otros: miembros de marca (incluido brand_manager) siguen sin acceso global', async () => {
  for (const u of ['uMgrA', 'uOwnerA']) { as(u); assert.equal((await bDel('bk-B')).status, 403, u); as(u); assert.equal((await pGet()).status, 403, u) }
})

// ── Corrección PROPUESTA para POST /api/payroll (pendiente de aprobación; NO cuenta como aprobada) ──
test('PROPUESTA payroll POST: ignora organization_id del cuerpo (usa la organización del administrador)', { todo: 'pendiente de aprobación' }, async () => {
  const db = as('uAdmin')
  await status(() => (payroll as any).POST(req('http://localhost/api/payroll', { name: 'n', organization_id: 'org-A', items: [] })))
  assert.ok(db.payroll_runs.every((r: any) => r.organization_id !== 'org-A' || r.id === 'pr-A'), 'no debe crear nóminas en org-A')
})
test('PROPUESTA payroll POST: rechaza importes no válidos (negativo, NaN, texto) con 422', { todo: 'pendiente de aprobación' }, async () => {
  for (const amount of [-5, 'abc', Number.NaN, 0]) {
    as('uAdmin'); const r = await (payroll as any).POST(req('http://localhost/api/payroll', { name: 'n', items: [{ influencer_id: 'i', amount }] }))
    assert.equal(r.status, 422, String(amount))
  }
})
test('PROPUESTA payroll POST: un no administrador recibe 403 antes de cualquier otra validación', { todo: 'pendiente de aprobación' }, async () => {
  as('uMgrA'); const r = await (payroll as any).POST(req('http://localhost/api/payroll', { name: 'n', organization_id: 'org-inexistente' }))
  assert.equal(r.status, 403)
})
