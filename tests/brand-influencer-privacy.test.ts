// Privacidad de influencers hacia las marcas (2026-11-02): las marcas ven a quienes postularon, participaron o están
// en su roster, pero nunca su email/teléfono/WhatsApp ni identificadores internos (user_id).
// Handlers REALES contra una base EN MEMORIA con datos ficticios (sin red, sin Supabase, sin producción).
// LÍMITES: no prueba RLS/privilegios reales ni PostgreSQL. La base en memoria no resuelve relaciones embebidas:
// cada fila lleva su `influencer`/`social_profiles` ya adjunto.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'

process.env.VERCEL_ENV = 'test' // el prebuild de Vercel corre estas pruebas: nunca con efectos externos
register('./support/ts-resolve.mjs', import.meta.url)
register('./support/route-harness.mjs', import.meta.url)

const { makeAdmin } = await import('./support/memory-supabase.ts')
const privacy = await import('../src/lib/brand-influencer-privacy.ts')
const barters = await import('../src/app/api/campaigns/[id]/barters/route.ts')
const ranking = await import('../src/app/api/brand/influencers/ranking/route.ts')

type Row = Record<string, any>
const m = (user_id: string, organization_id: string, role: string, brand_id: string | null, is_owner = false) =>
  ({ id: `m-${user_id}`, user_id, organization_id, role, brand_id, is_owner, is_active: true })

const INF1 = { id: 'inf-1', user_id: 'uInf1', display_name: 'Ana Aceptada', email: 'ana@test.invalid', phone: '+56911111111', whatsapp: '+56911111111', avatar_url: null, location_id: null, categories: ['Moda'], rating: 5 }
const INF2 = { id: 'inf-2', user_id: null, display_name: 'Beto Pendiente', email: 'beto@test.invalid', phone: '+56922222222', whatsapp: null, avatar_url: null, location_id: null, categories: [], rating: 4 }
const INF9 = { id: 'inf-9', user_id: 'uInf9', display_name: 'Zoe De Otra Marca', email: 'zoe@test.invalid', phone: '+56999999999', whatsapp: null, avatar_url: null, location_id: null, categories: [], rating: 3 }
const social = (id: string) => [{ platform: 'instagram', username: id, followers: 1000, engagement_rate: 3, is_primary: true }]

const fresh = (): Record<string, Row[]> => ({
  brands: [{ id: 'brand-A', organization_id: 'org-A', status: 'approved', name: 'Marca A' }, { id: 'brand-B', organization_id: 'org-B', status: 'approved', name: 'Marca B' }],
  organization_members: [
    m('uOwnerA', 'org-A', 'brand_manager', 'brand-A', true), m('uMemA', 'org-A', 'member', 'brand-A'),
    m('uOwnerB', 'org-B', 'brand_manager', 'brand-B', true), m('uAdmin', 'org-adm', 'super_admin', null),
  ],
  campaigns: [
    {
      id: 'camp-A', name: 'Campaña A', organization_id: 'org-A', brand_id: 'brand-A', created_by_brand_id: null, type: 'ugc', status: 'active', metadata: {}, currency: 'CLP', campaign_benefits: [],
      campaign_influencers: [
        { id: 'ci1', application_status: 'accepted', fee: 10, status: 'active', metadata: {}, influencer: { ...INF1, influencer_social_profiles: social('ana') } },
        { id: 'ci2', application_status: 'pending', fee: 0, status: 'active', metadata: {}, influencer: { ...INF2, influencer_social_profiles: social('beto') } },
      ],
      campaign_brands: [], campaign_deliverables: [],
    },
    { id: 'camp-B', name: 'Campaña B', organization_id: 'org-B', brand_id: 'brand-B', created_by_brand_id: null, type: 'ugc', status: 'active', metadata: {}, currency: 'CLP', campaign_benefits: [] },
  ],
  campaign_brands: [],
  // Roster propio, además de las campañas propias.
  brand_influencers: [{ brand_id: 'brand-A', influencer_id: 'inf-1' }, { brand_id: 'brand-B', influencer_id: 'inf-9' }],
  campaign_influencers: [
    { id: 'ci1', campaign_id: 'camp-A', influencer_id: 'inf-1', application_status: 'accepted', status: 'active', campaign: { name: 'Campaña A' } },
    { id: 'ci2', campaign_id: 'camp-A', influencer_id: 'inf-2', application_status: 'pending', status: 'active', campaign: { name: 'Campaña A' } },
    { id: 'ci9', campaign_id: 'camp-B', influencer_id: 'inf-9', application_status: 'accepted', status: 'active', campaign: { name: 'Campaña B' } },
  ],
  influencers: [
    { ...INF1, social_profiles: social('ana') }, { ...INF2, social_profiles: social('beto') }, { ...INF9, social_profiles: social('zoe') },
  ],
  campaign_deliverables: [], bookings: [], locations: [], subscriptions: [],
  barters: [
    { id: 'b1', campaign_id: 'camp-A', influencer_id: 'inf-1', created_at: '2026-10-01', status: 'pending', influencer: { id: 'inf-1', display_name: 'Ana Aceptada', avatar_url: null, email: 'ana@test.invalid' }, history: [], benefits: [] },
  ],
})
// projectColumns: la base respeta la lista de columnas del `.select(...)` (la ruta de ranking pide columnas explícitas).
const as = (user: string | null) => {
  const db = fresh()
  ;(globalThis as any).__routeHarness = { user: user ? { id: user, user_metadata: {} } : null, admin: makeAdmin(db, { signedBrandFixtures: true, projectColumns: true }) }
  return db
}
const req = (url: string) => ({ url, json: async () => ({}), headers: new Headers(), nextUrl: new URL(url) }) as any
const ctx = { params: { id: 'camp-A' } }
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const CONTACT = /ana@test|beto@test|zoe@test|\+569|"user_id"|uInf/

// ── Helper puro ────────────────────────────────────────────────────────────────
test('helper: quita email, teléfono, WhatsApp y user_id; conserva el resto; tolera null', () => {
  const clean = privacy.withoutInfluencerContact({ id: 'i', display_name: 'X', email: 'a@b', phone: '1', whatsapp: '2', user_id: 'u', categories: ['a'] })
  assert.deepEqual(clean, { id: 'i', display_name: 'X', categories: ['a'] })
  assert.equal(privacy.withoutInfluencerContact(null), null)
  assert.deepEqual(privacy.scrubInfluencerRelation({ id: 'ci', fee: 5, influencer: { id: 'i', email: 'a@b' } }), { id: 'ci', fee: 5, influencer: { id: 'i' } })
  assert.deepEqual(privacy.scrubInfluencerRelation({ id: 'ci', influencer: null }), { id: 'ci', influencer: null })
  assert.deepEqual(privacy.scrubInfluencerRelation({ id: 'ci' } as any), { id: 'ci' })
})

// ── Detalle de campaña ────────────────────────────────────────────────────────
// La ruta GET /api/campaigns/[id] no se puede ejecutar con la base en memoria (importa módulos con sintaxis TypeScript que
// Node no interpreta); su vista de marca se prueba con la función pura que usa y una guardia sobre el código de la ruta.
test('detalle de campaña (vista de marca): postulantes y participantes siguen visibles, sin email ni contacto', () => {
  const campaign = fresh().campaigns[0]
  const view = privacy.scrubCampaignInfluencers({ ...campaign, address: 'x' })
  const people = view.campaign_influencers as any[]
  assert.deepEqual(people.map(ci => ci.influencer.display_name).sort(), ['Ana Aceptada', 'Beto Pendiente'])
  assert.deepEqual(people.map(ci => ci.application_status).sort(), ['accepted', 'pending'])
  assert.ok(people.every(ci => ci.influencer.influencer_social_profiles.length === 1), 'conserva Instagram para buscar')
  assert.ok(people.every(ci => ci.fee !== undefined && ci.id), 'conserva el resto de la fila')
  assert.equal((view as any).address, 'x')
  assert.doesNotMatch(JSON.stringify(view), CONTACT)
  assert.equal(privacy.scrubCampaignInfluencers({ id: 'c' } as any).id, 'c')
})

test('detalle de campaña: solo la rama de marca se limpia; el admin conserva el email', () => {
  const src = read('src/app/api/campaigns/[id]/route.ts')
  const brandBranch = src.slice(src.indexOf('if (access?.isBrand) {'), src.indexOf('Mismo criterio que la lista'))
  assert.match(brandBranch, /scrubCampaignInfluencers\(campaignWithEvent\)/)
  assert.match(brandBranch, /_brand_permissions/)
  const adminPart = src.slice(src.indexOf('Mismo criterio que la lista'))
  assert.doesNotMatch(adminPart.slice(0, 600), /scrubCampaignInfluencers/)
})

// ── Canjes ─────────────────────────────────────────────────────────────────────
test('canjes: la marca gestiona y ve los canjes sin el email de la influencer; el Super Admin lo conserva', async () => {
  as('uOwnerA')
  const brand = await (barters as any).GET(req('http://x/api/campaigns/camp-A/barters'), ctx)
  assert.equal(brand.status, 200)
  const brandJson = await brand.json()
  assert.equal(brandJson.data.length, 1)
  assert.equal(brandJson.data[0].id, 'b1')
  assert.equal(brandJson.data[0].influencer.display_name, 'Ana Aceptada')
  assert.doesNotMatch(JSON.stringify(brandJson), /ana@test/)

  as('uAdmin')
  const adminJson = await (await (barters as any).GET(req('http://x/api/campaigns/camp-A/barters'), ctx)).json()
  assert.equal(adminJson.data[0].influencer.email, 'ana@test.invalid')

  as('uOwnerB')
  assert.equal((await (barters as any).GET(req('http://x/api/campaigns/camp-A/barters'), ctx)).status, 403)
})

// ── Ranking de marca ──────────────────────────────────────────────────────────
test('ranking de marca: solo influencers vinculadas a la marca, sin user_id; has_account conserva la lógica de conexión', async () => {
  const db = as('uOwnerA')
  const res = await (ranking as any).GET(req('http://x/api/brand/influencers/ranking'))
  assert.equal(res.status, 200)
  const json = await res.json()
  // Visibilidad (getBrandInfluencerScope): postulantes y participantes de sus campañas + roster; nunca de otra marca.
  assert.deepEqual(json.data.map((row: any) => row.display_name).sort(), ['Ana Aceptada', 'Beto Pendiente'], 'no incluye influencers de otra marca')
  const byName = (rows: any[], name: string) => rows.find(row => row.display_name === name)
  assert.equal(byName(json.data, 'Ana Aceptada').has_account, true)
  assert.equal(byName(json.data, 'Beto Pendiente').has_account, false, 'sin cuenta (user_id nulo)')
  assert.ok(json.data.every((row: any) => !('user_id' in row)))
  // La base en memoria no recorta columnas cuando el select trae relaciones: el recorte de email/teléfono lo cubre la
  // guardia estática de abajo; aquí se comprueba lo que esta corrección añade (sin user_id).
  assert.doesNotMatch(JSON.stringify(json), /uInf|"user_id"/)

  // Sin cuenta (user_id nulo): has_account=false, igual sin identificadores.
  db.influencers.find(i => i.id === 'inf-1')!.user_id = null
  ;(globalThis as any).__routeHarness = { user: { id: 'uOwnerA', user_metadata: {} }, admin: makeAdmin(db, { signedBrandFixtures: true, projectColumns: true }) }
  const sinCuenta = await (await (ranking as any).GET(req('http://x/api/brand/influencers/ranking'))).json()
  assert.equal(byName(sinCuenta.data, 'Ana Aceptada').has_account, false)

  as('uOwnerB')
  const other = await (await (ranking as any).GET(req('http://x/api/brand/influencers/ranking'))).json()
  assert.deepEqual(other.data.map((row: any) => row.display_name), ['Zoe De Otra Marca'])
  as(null)
  assert.equal((await (ranking as any).GET(req('http://x/api/brand/influencers/ranking'))).status, 401)
})

// ── Guardias estáticas ─────────────────────────────────────────────────────────
test('guardias: el componente de ranking usa has_account (con respaldo a user_id para admin) y no solo user_id', () => {
  const src = read('src/components/influencers/InfluencerRanking.tsx')
  assert.equal((src.match(/has_account \?\? Boolean\(inf\.user_id\)/g) ?? []).length, 3)
  assert.doesNotMatch(src, /!inf\.user_id|Boolean\(inf\.user_id\) &&|inf\.user_id \?/)
})

test('guardias: el ranking de marca pide columnas explícitas sin email, teléfono ni WhatsApp', () => {
  const src = read('src/app/api/brand/influencers/ranking/route.ts')
  const select = src.slice(src.indexOf(".from('influencers')"), src.indexOf('.in(\'id\', influencerIds)'))
  assert.match(select, /display_name/)
  assert.doesNotMatch(select, /\b(email|phone|whatsapp)\b|\*/)
  assert.match(src, /\.map\(\(\{ user_id, \.\.\.rest \}\) => \(\{ \.\.\.rest, has_account: Boolean\(user_id\) \}\)\)/)
})

test('guardias: las respuestas a marcas pasan por el helper de privacidad', () => {
  assert.match(read('src/app/api/campaigns/[id]/route.ts'), /scrubCampaignInfluencers/)
  assert.match(read('src/app/api/campaigns/[id]/barters/route.ts'), /scrubInfluencerRelation/)
})
