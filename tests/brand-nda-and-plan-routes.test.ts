// Handlers REALES contra una base EN MEMORIA con datos ficticios (sin red, sin Supabase, sin producción):
// solo el owner firma el NDA y paga el plan; member y 'finance' heredado no; otra marca no ve el documento.
// LÍMITES: no prueba RLS/grants reales.
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('./support/ts-resolve.mjs', import.meta.url)
register('./support/route-harness.mjs', import.meta.url)

const { makeAdmin } = await import('./support/memory-supabase.ts')
const nda = await import('../src/app/api/brand/documents/[id]/route.ts')
const docs = await import('../src/app/api/brand/documents/route.ts')
const checkout = await import('../src/app/api/paypal/checkout/route.ts')

type Row = Record<string, any>
type Db = Record<string, Row[]>
const m = (user_id: string, organization_id: string, role: string, brand_id: string | null, is_owner = false) =>
  ({ id: `m-${user_id}`, user_id, organization_id, role, brand_id, is_owner, is_active: true })

function freshDb(): Db {
  return {
    brands: [{ id: 'brand-A', organization_id: 'org-A', status: 'approved', name: 'Marca A' }, { id: 'brand-B', organization_id: 'org-B', status: 'approved', name: 'Marca B' }],
    organizations: [{ id: 'org-A', name: 'A' }, { id: 'org-B', name: 'B' }],
    organization_members: [
      m('uA-owner', 'org-A', 'brand_manager', 'brand-A', true), m('uA-member', 'org-A', 'member', 'brand-A'),
      m('uA-fin', 'org-A', 'finance', 'brand-A'), m('uB-owner', 'org-B', 'brand_manager', 'brand-B', true),
    ],
    brand_documents: [{ id: 'doc-A', brand_id: 'brand-A', status: 'pending', title: 'NDA A', document_type: 'nda' }],
    profiles: [],
  }
}

async function sign(user: string | null, db: Db) {
  ;(globalThis as any).__routeHarness = { user: user ? { id: user, email: `${user}@test.invalid` } : null, admin: makeAdmin(db, { projectColumns: true }) }
  const req = { url: 'http://localhost/api/brand/documents/doc-A', headers: new Headers(), json: async () => ({ accepted: true, signer_name: 'Ficticio', signer_rut: '1-9', signer_role: 'Rep' }) } as any
  const res = await (nda as any).PATCH(req, { params: { id: 'doc-A' } })
  return res.status as number
}

test('NDA: solo el owner pasa la autorización; member y finance heredado → 403 y el documento sigue pendiente', async () => {
  for (const user of ['uA-member', 'uA-fin']) {
    const db = freshDb()
    assert.equal(await sign(user, db), 403, user)
    assert.equal(db.brand_documents[0].status, 'pending', `${user} no debe firmar`)
  }
  assert.equal(await sign(null, freshDb()), 401)
  const owner = await sign('uA-owner', freshDb())
  assert.ok(![401, 403].includes(owner), `owner debe pasar la autorización (status ${owner})`)
})

test('NDA: el owner de OTRA marca no ve ni firma el documento (404) y no lo cambia', async () => {
  const db = freshDb()
  const s = await sign('uB-owner', db)
  assert.ok([404, 422].includes(s), `status ${s}`)
  assert.equal(db.brand_documents[0].status, 'pending')
})

test('NDA: member no puede ni listar los documentos legales (403)', async () => {
  ;(globalThis as any).__routeHarness = { user: { id: 'uA-member' }, admin: makeAdmin(freshDb(), { projectColumns: true }) }
  assert.equal(((await (docs as any).GET()) as Response).status, 403)
})

test('pago del plan (PayPal checkout): member → 403', async () => {
  ;(globalThis as any).__routeHarness = { user: { id: 'uA-member' }, admin: makeAdmin(freshDb(), { projectColumns: true }) }
  const res = await (checkout as any).POST({ url: 'http://localhost/api/paypal/checkout', headers: new Headers(), json: async () => ({ tier: 'pro' }) } as any)
  assert.equal(res.status, 403)
})
