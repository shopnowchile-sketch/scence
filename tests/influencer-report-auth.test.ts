// Hotfix influencer-report: la autorización exige rol (report.read) y propiedad de la campaña.
// Antes: cualquier miembro de la organización, de cualquier rol, obtenía el reporte de cualquier campaña de su org.
// Ejecuta el handler REAL contra una base en memoria (sin red ni producción). LÍMITES: no prueba RLS real ni el HTML
// completo. NO cubre el estado de la marca (pendiente/rechazada/suspendida): master aún no tiene esa lógica
// (brand-status-access); esa cobertura llega con la promoción de staging.
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('./support/ts-resolve.mjs', import.meta.url)
register('./support/route-harness.mjs', import.meta.url)
const { makeAdmin } = await import('./support/memory-supabase.ts')

type Row = Record<string, any>
const m = (user_id: string, organization_id: string, role: string, brand_id: string | null, is_owner = false) =>
  ({ id: `m-${user_id}-${organization_id}`, user_id, organization_id, role, brand_id, is_owner, is_active: true })

const fresh = (): Record<string, Row[]> => ({
  brands: [
    { id: 'brand-A', organization_id: 'org-A', status: 'approved' },
    { id: 'brand-B', organization_id: 'org-B', status: 'approved' },
  ],
  organization_members: [
    m('uOwnerA', 'org-A', 'brand_manager', 'brand-A', true), m('uMgrA', 'org-A', 'brand_manager', 'brand-A'),
    m('uMemA', 'org-A', 'member', 'brand-A'), m('uFinA', 'org-A', 'finance', 'brand-A'),
    m('uOwnerB', 'org-B', 'brand_manager', 'brand-B', true),
    m('uAdmin', 'org-adm', 'super_admin', null),
    m('uAdminB', 'org-B', 'super_admin', 'brand-B'), // admin de plataforma que además pertenece a otra marca
  ],
  campaigns: [
    { id: 'camp-A', organization_id: 'org-A', brand_id: 'brand-A', created_by_brand_id: null, name: 'Camp A', status: 'active', currency: 'CLP' },
    { id: 'camp-C', organization_id: 'org-A', brand_id: null, created_by_brand_id: 'brand-A', name: 'Camp C', status: 'active', currency: 'CLP' },
  ],
  campaign_influencers: [
    { id: 'ci1', campaign_id: 'camp-A', influencer_id: 'inf-in', fee: 1, currency: 'CLP', notes: null },
    { id: 'ci2', campaign_id: 'camp-C', influencer_id: 'inf-in', fee: 1, currency: 'CLP', notes: null },
  ],
  influencers: [
    { id: 'inf-in', display_name: 'Dentro', email: 'dentro@x.test', influencer_social_profiles: [] },
    { id: 'inf-out', display_name: 'Fuera', email: 'fuera@x.test', influencer_social_profiles: [] },
  ],
  campaign_deliverables: [],
  // brand-B solo colabora en camp-A: no es dueña ni creadora.
  campaign_brands: [{ brand_id: 'brand-B', campaign_id: 'camp-A', role: 'collab' }],
})

const req = (url: string) => ({ url, headers: new Headers(), nextUrl: new URL(url) }) as any
const call = async (user: string | null, camp: string, inf: string) => {
  ;(globalThis as any).__routeHarness = { user: user ? { id: user } : null, admin: makeAdmin(fresh()) }
  const route = await import('../src/app/api/campaigns/[id]/influencer-report/route.ts')
  try { return (await (route as any).GET(req(`http://localhost/x?influencer_id=${inf}`), { params: { id: camp } })).status as number } catch { return -1 }
}

test('sin sesión → 401; sin influencer_id → 400', async () => {
  assert.equal(await call(null, 'camp-A', 'inf-in'), 401)
  assert.equal(await call('uAdmin', 'camp-A', ''), 400)
})

test('roles de la marca dueña sin report.read (member, finance) → 404', async () => {
  for (const u of ['uMemA', 'uFinA']) assert.equal(await call(u, 'camp-A', 'inf-in'), 404, u)
})

test('otra marca, marca solo colaboradora (campaign_brands) y usuario sin vínculo → 404', async () => {
  assert.equal(await call('uOwnerB', 'camp-A', 'inf-in'), 404, 'otra marca / colaboradora')
  assert.equal(await call('uOwnerB', 'camp-C', 'inf-in'), 404, 'otra marca en campaña por created_by_brand_id')
  assert.equal(await call('uNadie', 'camp-A', 'inf-in'), 404, 'sin membresía')
})

test('la marca dueña solo obtiene influencers que participan en SU campaña; campaña inexistente → 404', async () => {
  assert.equal(await call('uOwnerA', 'camp-A', 'inf-out'), 404, 'influencer que no participa')
  assert.equal(await call('uOwnerA', 'camp-NOEXISTE', 'inf-in'), 404, 'campaña inexistente')
})

test('dueña (owner/brand_manager) y admin de plataforma obtienen el reporte (200)', async () => {
  for (const u of ['uOwnerA', 'uMgrA']) assert.equal(await call(u, 'camp-A', 'inf-in'), 200, u)
  assert.equal(await call('uOwnerA', 'camp-C', 'inf-in'), 200, 'dueña por created_by_brand_id')
  assert.equal(await call('uAdmin', 'camp-A', 'inf-in'), 200, 'admin')
  assert.equal(await call('uAdminB', 'camp-A', 'inf-in'), 200, 'super_admin con membresía de otra marca conserva acceso global')
})
