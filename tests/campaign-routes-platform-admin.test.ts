// report / influencers/export / collaboration-opportunity / duplicate: la administración de plataforma
// (super_admin ACTIVO) se evalúa primero; el resto conserva la autorización por marca + campaña + permiso.
// Base en memoria; sin red ni producción. LÍMITE: no prueba el contenido del PDF/Excel, solo la autorización.
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('./support/ts-resolve.mjs', import.meta.url)
register('./support/route-harness.mjs', import.meta.url)
const { makeAdmin } = await import('./support/memory-supabase.ts')

type Row = Record<string, any>
const m = (user_id: string, organization_id: string, role: string, brand_id: string | null, is_owner = false, is_active = true) =>
  ({ id: `m-${user_id}-${organization_id}`, user_id, organization_id, role, brand_id, is_owner, is_active })
const fresh = (): Record<string, Row[]> => ({
  brands: [
    { id: 'brand-A', organization_id: 'org-A', status: 'approved' },
    { id: 'brand-B', organization_id: 'org-B', status: 'approved' },
  ],
  organization_members: [
    m('uOwnerA', 'org-A', 'brand_manager', 'brand-A', true), m('uMgrA', 'org-A', 'brand_manager', 'brand-A'),
    m('uMemA', 'org-A', 'member', 'brand-A'), m('uFinA', 'org-A', 'finance', 'brand-A'),
    m('uMgrB', 'org-B', 'brand_manager', 'brand-B'),
    m('uAdmin', 'org-adm', 'super_admin', null),
    // admin ACTIVO que además es miembro (no dueño) de la marca B
    m('uDual', 'org-adm', 'super_admin', null), m('uDual', 'org-B', 'member', 'brand-B'),
    // ex-admin (super_admin INACTIVO) y brand_manager de la marca B
    m('uExAdmin', 'org-adm', 'super_admin', null, false, false), m('uExAdmin', 'org-B', 'brand_manager', 'brand-B'),
    // usuario con rol de organización sin marca, en la organización de la campaña
    m('uNoBrand', 'org-A', 'influencer', null),
  ],
  campaigns: [{ id: 'camp-A', name: 'C', organization_id: 'org-A', brand_id: 'brand-A', created_by_brand_id: null, type: 'ugc', status: 'active', metadata: {} }],
  campaign_brands: [], campaign_influencers: [], campaign_deliverables: [], influencers: [], influencer_social_profiles: [],
})
const as = (user: string | null) => { const db = fresh(); ;(globalThis as any).__routeHarness = { user: user ? { id: user, user_metadata: {} } : null, admin: makeAdmin(db, { projectColumns: true }) }; return db }
const mk = (url: string, body: unknown = {}) => ({ url, json: async () => body, headers: new Headers(), nextUrl: new URL(url) }) as any
const ctx = { params: { id: 'camp-A' } }
const st = async (fn: () => Promise<Response>) => { try { return (await fn()).status } catch { return 'OK_Y_FALLO_DESPUES' as const } }
const allowed = (v: unknown) => v !== 401 && v !== 403 && v !== 404

const report = await import('../src/app/api/campaigns/[id]/report/route.ts')
const exp = await import('../src/app/api/campaigns/[id]/influencers/export/route.ts')
const collab = await import('../src/app/api/campaigns/[id]/collaboration-opportunity/route.ts')
const dup = await import('../src/app/api/campaigns/[id]/duplicate/route.ts')
const ROUTES: Record<string, () => Promise<Response>> = {
  report: () => (report as any).GET(mk('http://x/api/campaigns/camp-A/report'), ctx),
  export: () => (exp as any).GET(mk('http://x/api/campaigns/camp-A/influencers/export'), ctx),
  collab: () => (collab as any).PUT(mk('http://x/api/campaigns/camp-A/collaboration-opportunity', { enabled: false }), ctx),
  duplicate: () => (dup as any).POST(mk('http://x/api/campaigns/camp-A/duplicate'), ctx),
}
// quién puede cada operación: report/export → report.read; collab/duplicate → campaign.manage
const WHO: Record<string, { yes: string[]; no: string[] }> = {
  report:    { yes: ['uAdmin', 'uDual', 'uOwnerA', 'uMgrA', 'uMemA'], no: ['uExAdmin', 'uFinA', 'uMgrB', 'uNoBrand'] },
  export:    { yes: ['uAdmin', 'uDual', 'uOwnerA', 'uMgrA', 'uMemA'], no: ['uExAdmin', 'uFinA', 'uMgrB', 'uNoBrand'] },
  collab:    { yes: ['uAdmin', 'uDual', 'uOwnerA', 'uMgrA', 'uMemA'], no: ['uExAdmin', 'uFinA', 'uMgrB', 'uNoBrand'] },
  duplicate: { yes: ['uAdmin', 'uDual', 'uOwnerA', 'uMgrA', 'uMemA'], no: ['uExAdmin', 'uFinA', 'uMgrB', 'uNoBrand'] },
}
for (const [name, call] of Object.entries(ROUTES)) {
  test(`${name}: sin sesión → 401`, async () => { as(null); assert.equal((await call()).status, 401) })
  test(`${name}: permitidos (admin activo, admin activo con marca ajena, owner, member)`, async () => {
    for (const u of WHO[name].yes) { as(u); const s = await st(call); assert.ok(allowed(s), `${u} → ${s}`) }
  })
  test(`${name}: denegados 403 (admin inactivo, finance sin acceso, otra marca, usuario sin marca)`, async () => {
    for (const u of WHO[name].no) { as(u); assert.equal((await call()).status, 403, u) }
  })
}
test('un admin inactivo con marca NO obtiene acceso global: campaña de OTRA marca → 403 en las 4 rutas', async () => {
  for (const [n, call] of Object.entries(ROUTES)) { as('uExAdmin'); assert.equal((await call()).status, 403, n) }
})
test('duplicate: el admin crea la copia; una marca ajena no crea nada', async () => {
  const db = as('uAdmin'); await st(ROUTES.duplicate)
  assert.equal(db.campaigns.filter(c => c.name === 'Copia de C').length, 1)
  const db2 = as('uMgrB'); await st(ROUTES.duplicate)
  assert.equal(db2.campaigns.length, 1)
})
