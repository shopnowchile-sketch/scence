// Ejecuta los handlers REALES de GET/PATCH /api/settings/organization contra una base EN MEMORIA con
// datos ficticios (sin red, sin Supabase, sin producción). Verifica que el acceso falle cerrado, que
// una marca solo toque su propia organización, que los tokens/ids de pasarela nunca salgan y que no
// exista la organización predeterminada como alternativa.
// LÍMITES: no prueba RLS/grants reales; maybeSingle() en memoria no reproduce el error de PostgREST
// con varias marcas por organización (el caso «marca ambigua» se cubre con una organización sin marca).
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('./support/ts-resolve.mjs', import.meta.url)
register('./support/route-harness.mjs', import.meta.url)

const { makeAdmin } = await import('./support/memory-supabase.ts')
const route = await import('../src/app/api/settings/organization/route.ts')

type Row = Record<string, any>
type Db = Record<string, Row[]>

const SECRET = { google_access_token: 'ya29.SECRETO-A', google_refresh_token: '1//SECRETO-R', google_token_expiry: '2030-01-01', stripe_customer_id: 'cus_X', stripe_subscription_id: 'sub_X', settings: { interno: true } }
const org = (id: string, name: string, extra: Row = {}) => ({ id, name, slug: id, website: null, industry: null, country: 'CL', tax_id: `NIF-${id}`, billing_email: `${id}@facturas.test`, currency: 'CLP', is_active: true, logo_url: null, ...SECRET, ...extra })
const member = (user_id: string, organization_id: string, role: string, brand_id: string | null, is_owner = false) => ({ id: `m-${user_id}-${organization_id}`, user_id, organization_id, role, brand_id, is_owner, is_active: true })

function freshDb(): Db {
  return {
    organizations: [
      org('org-A', 'Marca A'), org('org-B', 'Marca B'), org('org-P', 'Marca Pendiente'), org('org-R', 'Marca Rechazada'),
      org('org-S', 'Marca Suspendida'), org('org-sinmarca', 'Organización sin marca'), org('org-adm1', 'Admin 1'), org('org-adm2', 'Admin 2'),
    ],
    brands: [
      { id: 'brand-A', organization_id: 'org-A', status: 'approved' }, { id: 'brand-B', organization_id: 'org-B', status: 'approved' },
      { id: 'brand-P', organization_id: 'org-P', status: 'pending_approval' }, { id: 'brand-R', organization_id: 'org-R', status: 'rejected' },
      { id: 'brand-S', organization_id: 'org-S', status: 'suspended' },
    ],
    organization_members: [
      member('uA-owner', 'org-A', 'brand_manager', 'brand-A', true), member('uA-manager', 'org-A', 'brand_manager', 'brand-A'),
      member('uA-member', 'org-A', 'member', 'brand-A'), member('uA-fin', 'org-A', 'finance', 'brand-A'),
      member('uB-owner', 'org-B', 'brand_manager', 'brand-B', true),
      member('uP-owner', 'org-P', 'brand_manager', 'brand-P', true), member('uR-owner', 'org-R', 'brand_manager', 'brand-R', true),
      member('uS-owner', 'org-S', 'brand_manager', 'brand-S', true),
      member('uOrphan', 'org-sinmarca', 'member', null),
      member('uAdmin1', 'org-adm1', 'super_admin', null, true),
      member('uAdmin2', 'org-adm1', 'super_admin', null), member('uAdmin2', 'org-adm2', 'super_admin', null),
    ],
  }
}

async function call(handler: 'GET' | 'PATCH', opts: { user: string | null; db: Db; query?: string; body?: unknown }) {
  ;(globalThis as any).__routeHarness = { user: opts.user ? { id: opts.user } : null, admin: makeAdmin(opts.db, { projectColumns: true }) }
  const req = { url: `http://localhost/api/settings/organization${opts.query ?? ''}`, json: async () => opts.body } as any
  const res = await (route as any)[handler](req)
  return { status: res.status as number, json: (await res.json()) as any }
}
const row = (db: Db, id: string) => db.organizations.find(o => o.id === id)!
const noSecrets = (data: Row) => { for (const k of Object.keys(SECRET)) assert.ok(!(k in data), `la respuesta expone ${k}`) }

test('GET: sin sesión 401; sin membresía, influencer o acceso de marca no resuelto → 403 (ya no cae a una organización predeterminada)', async () => {
  const db = freshDb()
  assert.equal((await call('GET', { user: null, db })).status, 401)
  for (const user of ['uInfluencer', 'uOrphan']) assert.equal((await call('GET', { user, db })).status, 403, user)
})

test('GET: cada rol de marca lee SOLO su organización y la respuesta no trae tokens ni datos de pasarela', async () => {
  const db = freshDb()
  for (const user of ['uA-owner', 'uA-manager', 'uA-member']) {
    const r = await call('GET', { user, db })
    assert.equal(r.status, 200, user)
    assert.equal(r.json.data.id, 'org-A', user)
    assert.equal(r.json.data.billing_email, 'org-A@facturas.test')
    noSecrets(r.json.data)
  }
  assert.equal((await call('GET', { user: 'uA-fin', db })).status, 403, 'finance ya no es rol de marca')
  assert.equal((await call('GET', { user: 'uB-owner', db })).json.data.id, 'org-B')
})

test('GET: una marca no puede pedir la organización de otra (organization_id ajeno → 403)', async () => {
  const db = freshDb()
  assert.equal((await call('GET', { user: 'uB-owner', db, query: '?organization_id=org-A' })).status, 403)
  assert.equal((await call('GET', { user: 'uA-owner', db, query: '?organization_id=org-A' })).status, 200)
  assert.equal((await call('GET', { user: 'uA-owner', db, query: '?organization_id=org-adm1' })).status, 403)
})

test('GET: administración — una membresía basta; con varias exige organization_id propio; ajeno → 403', async () => {
  const db = freshDb()
  const one = await call('GET', { user: 'uAdmin1', db }); assert.equal(one.status, 200); assert.equal(one.json.data.id, 'org-adm1'); noSecrets(one.json.data)
  const amb = await call('GET', { user: 'uAdmin2', db })
  assert.equal(amb.status, 409, 'dos membresías sin indicar cuál: no se elige por antigüedad')
  assert.equal(amb.json.code, 'ORGANIZATION_SELECTION_REQUIRED')
  assert.deepEqual(amb.json.organizations.map((o: Row) => o.id).sort(), ['org-adm1', 'org-adm2'], 'ofrece solo SUS organizaciones')
  for (const o of amb.json.organizations) assert.deepEqual(Object.keys(o).sort(), ['id', 'name'], 'solo id y nombre')
  assert.equal((await call('GET', { user: 'uAdmin2', db, query: '?organization_id=org-adm2' })).status, 200, 'elegida explícitamente')
  assert.equal((await call('GET', { user: 'uAdmin2', db, query: '?organization_id=org-A' })).status, 403, 'no puede elegir una ajena')
  assert.equal((await call('GET', { user: 'uAdmin2', db, query: '?organization_id=org-adm2' })).json.data.id, 'org-adm2')
  assert.equal((await call('GET', { user: 'uAdmin1', db, query: '?organization_id=org-A' })).status, 403, 'un admin no lee organizaciones que no son suyas por esta ruta')
})

test('GET: el estado de la marca no oculta su propio resultado (rechazada y suspendida ven su organización)', async () => {
  const db = freshDb()
  for (const user of ['uP-owner', 'uR-owner', 'uS-owner']) assert.equal((await call('GET', { user, db })).status, 200, user)
})

test('PATCH: solo el propietario edita; manager, miembro y finanzas → 403 y la base no cambia', async () => {
  for (const user of ['uA-manager', 'uA-member', 'uA-fin', 'uOrphan', 'uInfluencer']) {
    const db = freshDb(); const before = JSON.stringify(db)
    assert.equal((await call('PATCH', { user, db, body: { name: 'Hackeada', billing_email: 'x@x.test' } })).status, 403, user)
    assert.equal(JSON.stringify(db), before, `${user} no debe cambiar nada`)
  }
  const db = freshDb()
  const r = await call('PATCH', { user: 'uA-owner', db, body: { name: 'Marca A SpA', billing_email: 'nueva@a.test', tax_id: '76.000.000-0' } })
  assert.equal(r.status, 200); assert.equal(row(db, 'org-A').name, 'Marca A SpA'); assert.equal(row(db, 'org-A').billing_email, 'nueva@a.test')
  noSecrets(r.json.data)
  assert.equal(row(db, 'org-B').name, 'Marca B', 'otra marca intacta')
})

test('PATCH: no se pueden escribir tokens, ids de pasarela, slug ni id, ni apuntar a otra organización', async () => {
  const db = freshDb()
  const r = await call('PATCH', { user: 'uA-owner', db, body: { name: 'Marca A', google_refresh_token: 'ROBADO', google_access_token: 'ROBADO', stripe_customer_id: 'cus_ROBADO', slug: 'otro', id: 'org-B', organization_id: 'org-B' } })
  assert.equal(r.status, 200)
  assert.equal(row(db, 'org-A').google_refresh_token, SECRET.google_refresh_token)
  assert.equal(row(db, 'org-A').stripe_customer_id, 'cus_X')
  assert.equal(row(db, 'org-A').slug, 'org-A'); assert.equal(row(db, 'org-A').id, 'org-A')
  const before = JSON.stringify(row(db, 'org-B'))
  assert.equal((await call('PATCH', { user: 'uA-owner', db, query: '?organization_id=org-B', body: { name: 'Robada' } })).status, 403)
  assert.equal(JSON.stringify(row(db, 'org-B')), before)
})

test('PATCH: según el estado — pendiente completa su perfil; rechazada y suspendida no editan', async () => {
  let db = freshDb()
  assert.equal((await call('PATCH', { user: 'uP-owner', db, body: { name: 'Pendiente SpA' } })).status, 200)
  for (const user of ['uR-owner', 'uS-owner']) {
    db = freshDb(); const before = JSON.stringify(db)
    assert.equal((await call('PATCH', { user, db, body: { name: 'X' } })).status, 403, user)
    assert.equal(JSON.stringify(db), before)
  }
})

test('PATCH: administración edita solo una organización propia; con dos membresías sin indicar cuál no cambia nada', async () => {
  let db = freshDb()
  assert.equal((await call('PATCH', { user: 'uAdmin1', db, body: { name: 'Admin Uno' } })).status, 200)
  assert.equal(row(db, 'org-adm1').name, 'Admin Uno')
  db = freshDb(); const before = JSON.stringify(db)
  assert.equal((await call('PATCH', { user: 'uAdmin2', db, body: { name: 'Ambigua' } })).status, 409)
  assert.equal(JSON.stringify(db), before)
  assert.equal((await call('PATCH', { user: 'uAdmin1', db, query: '?organization_id=org-A', body: { name: 'Ajena' } })).status, 403)
  assert.equal(JSON.stringify(db), before)
})

test('el código ya no usa getOrgId ni select abierto en esta ruta', async () => {
  const { readFileSync } = await import('node:fs')
  const raw = readFileSync(new URL('../src/app/api/settings/organization/route.ts', import.meta.url), 'utf8')
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '') // sin comentarios
  assert.doesNotMatch(src, /getOrgId/)
  assert.doesNotMatch(src, /\.select\(\s*(['"`]\*['"`])?\s*\)/)
})
