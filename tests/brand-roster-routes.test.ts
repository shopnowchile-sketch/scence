// Handlers reales y permisos reales; datos ficticios en memoria, sin red.
// El simulador no proyecta joins: la privacidad de columnas se revisa en el SELECT de la ruta.
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
register('./support/ts-resolve.mjs', import.meta.url)
register('./support/route-harness.mjs', import.meta.url)
const { makeAdmin } = await import('./support/memory-supabase.ts')
const { GET } = await import('../src/app/api/brand/influencers/route.ts')

function fixture() {
  return {
    brands: [{ id: 'A', organization_id: 'org-A', status: 'approved' }, { id: 'B', organization_id: 'org-B', status: 'approved' }],
    organization_members: [
      { user_id: 'owner', organization_id: 'org-A', brand_id: 'A', role: 'brand_manager', is_owner: true, is_active: true },
      { user_id: 'member', organization_id: 'org-A', brand_id: 'A', role: 'member', is_owner: false, is_active: true },
      { user_id: 'other', organization_id: 'org-B', brand_id: 'B', role: 'member', is_active: true },
    ],
    campaigns: [{ id: 'a', brand_id: 'A' }, { id: 'created', brand_id: 'B', created_by_brand_id: 'A' }, { id: 'b', brand_id: 'B' }, { id: 'collab', brand_id: 'B' }],
    campaign_brands: [{ campaign_id: 'collab', brand_id: 'A' }],
    campaign_influencers: [
      { campaign_id: 'a', influencer_id: 'accepted', application_status: 'accepted' },
      { campaign_id: 'a', influencer_id: 'pending', application_status: 'pending' },
      { campaign_id: 'a', influencer_id: 'rejected', application_status: 'rejected' },
      { campaign_id: 'created', influencer_id: 'created', application_status: 'pending' },
      { campaign_id: 'b', influencer_id: 'foreign', application_status: 'pending' },
      { campaign_id: 'collab', influencer_id: 'collab', application_status: 'accepted' },
    ],
    brand_influencers: [{ brand_id: 'A', influencer_id: 'own' }, { brand_id: 'A', influencer_id: 'pending' }, { brand_id: 'B', influencer_id: 'foreign-roster' }],
    influencers: ['accepted', 'pending', 'rejected', 'created', 'foreign', 'own', 'foreign-roster', 'collab', 'global'].map(id => ({ id, display_name: id })),
    locations: [], subscriptions: [],
  }
}

async function call(user: string | null, db = fixture(), query = '', failSelectOn?: string) {
  const admin = makeAdmin(db, { failSelectOn })
  const from = admin.from
  // El simulador compartido solo soporta OR temporal. Aquí añadimos OR de igualdad
  // para ejecutar el filtro real de campañas, sin cambiar otras pruebas.
  admin.from = (table: string) => {
    const builder = from(table)
    if (table === 'campaigns') builder.or = (expression: string) => {
      const clauses = expression.split(',').map(clause => {
        const [column, operator, value] = clause.split('.')
        assert.equal(operator, 'eq')
        return { column, value }
      })
      return builder.in('id', db.campaigns.filter(row => clauses.some(({ column, value }) => (row as Record<string, unknown>)[column] === value)).map(row => row.id))
    }
    return builder
  }
  ;(globalThis as any).__routeHarness = { user: user ? { id: user } : null, admin }
  const response = await GET(new Request(`http://localhost/api/brand/influencers${query}`) as any)
  return { status: response.status, body: await response.json() }
}

test('owner y member reciben toda influencer relacionada (cualquier estado, colaboradas y roster propio), sin duplicados', async () => {
  for (const user of ['owner', 'member']) {
    const result = await call(user)
    assert.equal(result.status, 200)
    assert.deepEqual(result.body.data.map((row: any) => row.id).sort(), ['accepted', 'collab', 'created', 'own', 'pending', 'rejected'])
    assert.equal(result.body.full_access, false)
  }
})
test('parámetros ajenos no cambian la marca resuelta; resumen usa el mismo alcance', async () => {
  const result = await call('member', fixture(), '?brand_id=B&organization_id=org-B&scope=all')
  assert.equal(result.body.data.some((row: any) => row.id === 'foreign'), false)
  assert.equal((await call('member', fixture(), '?summary=1')).body.summary.total, 6)
})
test('sin sesión, sin membresía y marca suspendida no acceden', async () => {
  assert.equal((await call(null)).status, 401)
  assert.equal((await call('influencer')).status, 404)
  const db = fixture(); db.brands[0].status = 'suspended'
  assert.equal((await call('member', db)).status, 403)
})
test('marca sin relaciones obtiene vacío; error del roster no abre catálogo', async () => {
  const db = fixture(); db.campaigns = []; db.campaign_brands = []; db.brand_influencers = []
  assert.deepEqual((await call('member', db)).body.data, [])
  assert.equal((await call('member', fixture(), '', 'brand_influencers')).status, 500)
})
test('nunca aparecen influencers ajenas (otra marca, roster ajeno, catálogo global)', async () => {
  const ids = (await call('member')).body.data.map((row: any) => row.id)
  for (const foreign of ['foreign', 'foreign-roster', 'global']) assert.equal(ids.includes(foreign), false)
})
test('la búsqueda filtra dentro del alcance y nunca lo amplía (término corto incluido)', async () => {
  assert.deepEqual((await call('member', fixture(), '?search=acc')).body.data.map((row: any) => row.id), ['accepted'])
  const short = await call('member', fixture(), '?search=a')
  assert.equal(short.status, 200)
  for (const foreign of ['foreign', 'foreign-roster', 'global']) assert.equal(short.body.data.some((row: any) => row.id === foreign), false)
  assert.equal((await call('member', fixture(), '?search=zzz')).body.data.length, 0)
})
