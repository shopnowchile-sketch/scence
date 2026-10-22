// Ejecuta los handlers REALES de /api/invoices (GET/POST), /api/invoices/[id]
// (GET/PATCH/DELETE) y /api/invoices/[id]/shares contra una base EN MEMORIA con datos
// ficticios (tests/support/memory-supabase.ts). Sin .env.local, sin red, sin Supabase,
// sin producción. Verifica el aislamiento entre marcas, el acceso compartido y los pagos.
//
// LÍMITES (no se prueba aquí): RLS/grants y triggers reales de PostgreSQL (revisar la
// migración 20261022120000 en una base aislada), joins de PostgREST (los select con
// relaciones devuelven filas planas), el envío real de correo y la UI.
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('./support/ts-resolve.mjs', import.meta.url)
register('./support/route-harness.mjs', import.meta.url)

const { makeAdmin } = await import('./support/memory-supabase.ts')
const list = await import('../src/app/api/invoices/route.ts')
const one = await import('../src/app/api/invoices/[id]/route.ts')
const shares = await import('../src/app/api/invoices/[id]/shares/route.ts')

type Row = Record<string, any>
type Db = Record<string, Row[]>

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const BRAND_A = U(1), BRAND_B = U(2), BRAND_C = U(3)

function freshDb(): Db {
  return {
    organizations: [{ id: 'org-agency', name: 'Agencia ficticia' }, { id: 'org-A', name: 'Marca A ficticia' }, { id: 'org-B', name: 'Marca B ficticia' }],
    brands: [
      { id: BRAND_A, organization_id: 'org-A', name: 'Marca A' },
      { id: BRAND_B, organization_id: 'org-B', name: 'Marca B' },
      { id: BRAND_C, organization_id: 'org-C', name: 'Marca C' },
    ],
    organization_members: [
      { id: 'm1', user_id: 'u-admin', organization_id: 'org-agency', role: 'super_admin', is_active: true, brand_id: null, is_owner: true },
      { id: 'm2', user_id: 'u-A-owner', organization_id: 'org-A', role: 'brand_manager', is_active: true, brand_id: BRAND_A, is_owner: true },
      { id: 'm3', user_id: 'u-A-member', organization_id: 'org-A', role: 'member', is_active: true, brand_id: BRAND_A, is_owner: false },
      { id: 'm4', user_id: 'u-A-finance', organization_id: 'org-A', role: 'finance', is_active: true, brand_id: BRAND_A, is_owner: false },
      { id: 'm5', user_id: 'u-B-owner', organization_id: 'org-B', role: 'brand_manager', is_active: true, brand_id: BRAND_B, is_owner: true },
      { id: 'm6', user_id: 'u-C-owner', organization_id: 'org-C', role: 'brand_manager', is_active: true, brand_id: BRAND_C, is_owner: true },
    ],
    campaigns: [
      { id: 'camp-A', organization_id: 'org-agency', brand_id: BRAND_A, created_by_brand_id: null },
      { id: 'camp-B', organization_id: 'org-agency', brand_id: BRAND_B, created_by_brand_id: null },
    ],
    invoices: [
      { id: 'inv-A1', invoice_number: 'T-A1', organization_id: 'org-A', owner_brand_id: BRAND_A, brand_id: null, status: 'sent', total: 100, currency: 'CLP', issued_by: 'u-A-owner', metadata: { client_name: 'Cliente A', client_email: 'a@cliente.test' } },
      { id: 'inv-A2', invoice_number: 'T-A2', organization_id: 'org-A', owner_brand_id: BRAND_A, brand_id: null, status: 'draft', total: 50, currency: 'CLP', issued_by: 'u-A-owner', metadata: { client_name: 'Cliente A2' } },
      { id: 'inv-B1', invoice_number: 'T-B1', organization_id: 'org-B', owner_brand_id: BRAND_B, brand_id: null, status: 'sent', total: 900, currency: 'CLP', issued_by: 'u-B-owner', metadata: { client_name: 'Cliente B', client_email: 'b@cliente.test' } },
      // Histórica: emitida por SCENCE, brand_id (receptora) = A. brand_id NO concede acceso.
      { id: 'inv-legacy', invoice_number: 'T-L1', organization_id: 'org-agency', owner_brand_id: null, brand_id: BRAND_A, status: 'sent', total: 700, currency: 'CLP', issued_by: 'u-admin', metadata: { client_name: 'Receptora A' } },
      { id: 'inv-collab', invoice_number: 'T-C1', organization_id: 'org-agency', owner_brand_id: null, brand_id: BRAND_C, status: 'sent', total: 300, currency: 'CLP', issued_by: 'u-admin', metadata: { client_name: 'Colab', kind: 'campaign_brand_collaboration', application_id: 'app-1' } },
      { id: 'inv-other', invoice_number: 'T-C2', organization_id: 'org-agency', owner_brand_id: null, brand_id: BRAND_C, status: 'sent', total: 400, currency: 'CLP', issued_by: 'u-admin', metadata: { client_name: 'Otra', kind: 'campaign_brand_collaboration', application_id: 'app-2' } },
    ],
    invoice_line_items: [],
    invoice_shares: [],
    campaign_brand_applications: [
      { id: 'app-1', campaign_id: 'camp-A', brand_id: BRAND_C, status: 'approved_for_payment', invoice_id: 'inv-collab' },
      // application_id de metadata apunta a app-2 pero esa solicitud pertenece a OTRA factura.
      { id: 'app-2', campaign_id: 'camp-B', brand_id: BRAND_C, status: 'approved_for_payment', invoice_id: 'inv-someone-else' },
    ],
    campaign_brands: [],
  }
}

const snapshot = (db: Db) => JSON.parse(JSON.stringify(db))

async function call(
  mod: any, handler: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  opts: { user: string | null; db: Db; id?: string; body?: unknown; query?: string; fail?: Record<string, string> },
) {
  ;(globalThis as any).__routeHarness = {
    user: opts.user ? { id: opts.user } : null,
    admin: makeAdmin(opts.db, { autoId: true, ...(opts.fail ?? {}) }),
  }
  const path = opts.id ? `/api/invoices/${opts.id}` : '/api/invoices'
  const req = { url: `http://localhost${path}${opts.query ?? ''}`, json: async () => opts.body } as any
  const res = await mod[handler](req, { params: { id: opts.id ?? '' } })
  return { status: res.status as number, json: (await res.json()) as any }
}
const inv = (db: Db, id: string) => db.invoices.find(i => i.id === id)!
const ids = (r: { json: any }) => (r.json.data as Row[]).map(i => i.id).sort()

// ── 1/13/14. Listado ────────────────────────────────────────────────────────

test('la marca A lista SOLO sus facturas; no ve las de B ni las históricas aunque su brand_id sea A', async () => {
  const db = freshDb()
  const r = await call(list, 'GET', { user: 'u-A-owner', db })
  assert.equal(r.status, 200)
  assert.deepEqual(ids(r), ['inv-A1', 'inv-A2'])
  assert.ok(!ids(r).includes('inv-B1'))
  assert.ok(!ids(r).includes('inv-legacy'), 'brand_id (receptora) no concede acceso: propiedad ≠ receptora')
  assert.ok((r.json.data as Row[]).every(i => i.access === 'owner' && i.read_only === false))
})

test('la marca B solo ve las suyas; SCENCE ve todas', async () => {
  const db = freshDb()
  assert.deepEqual(ids(await call(list, 'GET', { user: 'u-B-owner', db })), ['inv-B1'])
  const admin = await call(list, 'GET', { user: 'u-admin', db })
  assert.deepEqual(ids(admin), ['inv-A1', 'inv-A2', 'inv-B1', 'inv-collab', 'inv-legacy', 'inv-other'])
})

test('sin sesión 401; usuario sin marca ni admin (otra organización/influencer) 403; rol sin billing 403', async () => {
  const db = freshDb()
  assert.equal((await call(list, 'GET', { user: null, db })).status, 401)
  assert.equal((await call(list, 'GET', { user: 'u-stranger', db })).status, 403)
  assert.equal((await call(list, 'GET', { user: 'u-A-member', db })).status, 403)
})

test('un parámetro brand_id/owner_brand_id/organization_id en la URL no cambia el alcance de la marca', async () => {
  const db = freshDb()
  const r = await call(list, 'GET', { user: 'u-A-owner', db, query: `?owner_brand_id=${BRAND_B}&brand_id=${BRAND_B}&organization_id=org-B` })
  assert.deepEqual(ids(r), ['inv-A1', 'inv-A2'])
})

// ── 2/3/4. Consulta, edición, borrado y pago por ID de otra marca ──────────

test('la marca A NO puede consultar, editar, borrar ni pagar facturas de B ni históricas cambiando el ID (404, sin escribir)', async () => {
  for (const target of ['inv-B1', 'inv-legacy', 'inv-collab']) {
    const db = freshDb()
    const before = snapshot(db)
    assert.equal((await call(one, 'GET', { user: 'u-A-owner', db, id: target })).status, 404, `GET ${target}`)
    assert.equal((await call(one, 'PATCH', { user: 'u-A-owner', db, id: target, body: { action: 'mark_paid' } })).status, 404, `mark_paid ${target}`)
    assert.equal((await call(one, 'PATCH', { user: 'u-A-owner', db, id: target, body: { notes: 'x' } })).status, 404, `edit ${target}`)
    assert.equal((await call(one, 'PATCH', { user: 'u-A-owner', db, id: target, body: { action: 'void' } })).status, 404, `void ${target}`)
    assert.equal((await call(one, 'DELETE', { user: 'u-A-owner', db, id: target })).status, 404, `DELETE ${target}`)
    assert.equal((await call(shares, 'POST', { user: 'u-A-owner', db, id: target, body: { brand_id: BRAND_C } })).status, 404, `share ${target}`)
    assert.deepEqual(snapshot(db), before, `${target} no debe modificarse`)
  }
})

test('una factura inexistente y una ajena responden igual (404): no se puede enumerar IDs', async () => {
  const db = freshDb()
  const ghost = await call(one, 'GET', { user: 'u-A-owner', db, id: 'inv-no-existe' })
  const other = await call(one, 'GET', { user: 'u-A-owner', db, id: 'inv-B1' })
  assert.equal(ghost.status, 404)
  assert.deepEqual(ghost.json, other.json)
})

test('usuarios de otra organización / sin membresía no obtienen acceso accidental', async () => {
  const db = freshDb()
  const before = snapshot(db)
  for (const user of ['u-stranger', 'u-C-owner']) {
    assert.equal((await call(one, 'GET', { user, db, id: 'inv-A1' })).status, 404, user)
    assert.equal((await call(one, 'PATCH', { user, db, id: 'inv-A1', body: { action: 'mark_paid' } })).status, 404, user)
  }
  assert.deepEqual(snapshot(db), before)
})

// ── 5/6. Pago por la marca propietaria ─────────────────────────────────────

test('la marca propietaria marca pagada SU factura: status, paid_at y referencia', async () => {
  const db = freshDb()
  const r = await call(one, 'PATCH', { user: 'u-A-owner', db, id: 'inv-A1', body: { action: 'mark_paid', payment_reference: 'TRX-9' } })
  assert.equal(r.status, 200)
  const row = inv(db, 'inv-A1')
  assert.equal(row.status, 'paid')
  assert.ok(row.paid_at)
  assert.equal(row.payment_reference, 'TRX-9')
  assert.equal(inv(db, 'inv-B1').status, 'sent', 'la factura de B no se toca')
  // Con rol finance de la misma marca también corresponde (billing.manage).
  const r2 = await call(one, 'PATCH', { user: 'u-A-finance', db: freshDb(), id: 'inv-A1', body: { action: 'mark_paid' } })
  assert.equal(r2.status, 200)
})

test('una marca propietaria SIN permiso de facturación no puede marcarla pagada', async () => {
  const db = freshDb()
  const before = snapshot(db)
  const r = await call(one, 'PATCH', { user: 'u-A-member', db, id: 'inv-A1', body: { action: 'mark_paid' } })
  assert.ok([403, 404].includes(r.status))
  assert.deepEqual(snapshot(db), before)
})

test('doble mark_paid concurrente: solo se aplica una vez (200 + 409)', async () => {
  const db = freshDb()
  const results = await Promise.all([
    call(one, 'PATCH', { user: 'u-A-owner', db, id: 'inv-A1', body: { action: 'mark_paid', payment_reference: 'R1' } }),
    call(one, 'PATCH', { user: 'u-A-owner', db, id: 'inv-A1', body: { action: 'mark_paid', payment_reference: 'R2' } }),
  ])
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409])
})

// ── 10/11. void, mark_overdue y campos protegidos ──────────────────────────

test('void y mark_overdue: la marca propietaria recibe 403; SCENCE puede', async () => {
  for (const action of ['void', 'mark_overdue']) {
    const db = freshDb()
    const before = snapshot(db)
    assert.equal((await call(one, 'PATCH', { user: 'u-A-owner', db, id: 'inv-A1', body: { action } })).status, 403, action)
    assert.deepEqual(snapshot(db), before)
    assert.equal((await call(one, 'PATCH', { user: 'u-admin', db, id: 'inv-A1', body: { action } })).status, 200, action)
  }
})

test('campos financieros y de propiedad protegidos por la ruta (422) y la base no cambia', async () => {
  for (const field of ['total', 'status', 'paid_at', 'organization_id', 'owner_brand_id', 'brand_id', 'campaign_id', 'invoice_number', 'tax_rate', 'currency', 'metadata']) {
    const db = freshDb()
    const before = snapshot(db)
    const r = await call(one, 'PATCH', { user: 'u-A-owner', db, id: 'inv-A1', body: { [field]: field === 'metadata' ? { kind: 'x' } : BRAND_B } })
    assert.equal(r.status, 422, field)
    assert.deepEqual(snapshot(db), before, field)
  }
})

test('la marca propietaria edita campos permitidos de su factura', async () => {
  const db = freshDb()
  const r = await call(one, 'PATCH', { user: 'u-A-owner', db, id: 'inv-A1', body: { notes: 'nota nueva', client_email: 'nuevo@cliente.test' } })
  assert.equal(r.status, 200)
  assert.equal(inv(db, 'inv-A1').notes, 'nota nueva')
  assert.equal(inv(db, 'inv-A1').metadata.client_email, 'nuevo@cliente.test')
  assert.equal(inv(db, 'inv-A1').metadata.client_name, 'Cliente A', 'merge: no se pierden otras claves')
})

// ── DELETE ──────────────────────────────────────────────────────────────────

test('DELETE: solo borradores; la marca borra los suyos; SCENCE los de cualquiera', async () => {
  const db = freshDb()
  assert.equal((await call(one, 'DELETE', { user: 'u-A-owner', db, id: 'inv-A1' })).status, 409, 'enviada: no se borra')
  assert.equal((await call(one, 'DELETE', { user: 'u-A-owner', db, id: 'inv-A2' })).status, 200)
  assert.ok(!db.invoices.some(i => i.id === 'inv-A2'))
  assert.equal((await call(one, 'DELETE', { user: 'u-admin', db, id: 'inv-A1' })).status, 409)
})

// ── 6/9. SCENCE gestiona facturas de distintas marcas ─────────────────────

test('SCENCE consulta y gestiona facturas de distintas marcas y sin propietario', async () => {
  const db = freshDb()
  for (const id of ['inv-A1', 'inv-B1', 'inv-legacy']) {
    assert.equal((await call(one, 'GET', { user: 'u-admin', db, id })).status, 200, id)
  }
  assert.equal((await call(one, 'PATCH', { user: 'u-admin', db, id: 'inv-B1', body: { action: 'mark_paid' } })).status, 200)
  assert.equal(inv(db, 'inv-B1').status, 'paid')
  assert.equal((await call(one, 'PATCH', { user: 'u-admin', db, id: 'inv-legacy', body: { action: 'void' } })).status, 200)
})

// ── 7/8. Acceso compartido ─────────────────────────────────────────────────

test('acceso compartido: A lee la factura de B (redactada), pero NO modifica, borra, paga ni re-comparte', async () => {
  const db = freshDb()
  const grant = await call(shares, 'POST', { user: 'u-B-owner', db, id: 'inv-B1', body: { brand_id: BRAND_A } })
  assert.equal(grant.status, 201)
  assert.equal(db.invoice_shares.length, 1)
  assert.equal(db.invoice_shares[0].granted_by, 'u-B-owner')

  const read = await call(one, 'GET', { user: 'u-A-owner', db, id: 'inv-B1' })
  assert.equal(read.status, 200)
  assert.equal(read.json.data.read_only, true)
  assert.equal(read.json.data.access, 'shared')
  for (const hidden of ['organization_id', 'issued_by', 'owner_brand_id', 'stripe_invoice_id', 'metadata']) {
    assert.ok(!(hidden in read.json.data), `${hidden} no debe exponerse en una factura compartida`)
  }

  const before = snapshot(db)
  for (const [method, body] of [['PATCH', { action: 'mark_paid' }], ['PATCH', { action: 'send' }], ['PATCH', { action: 'void' }], ['PATCH', { notes: 'x' }], ['DELETE', undefined]] as const) {
    const r = await call(one, method, { user: 'u-A-owner', db, id: 'inv-B1', body })
    assert.equal(r.status, 403, `${method} ${JSON.stringify(body)}`)
  }
  assert.equal((await call(shares, 'POST', { user: 'u-A-owner', db, id: 'inv-B1', body: { brand_id: BRAND_C } })).status, 403, 'no puede re-compartir')
  assert.equal((await call(shares, 'DELETE', { user: 'u-A-owner', db, id: 'inv-B1', query: `?brand_id=${BRAND_A}` })).status, 403, 'no puede revocar')
  assert.deepEqual(snapshot(db), before, 'ninguna escritura')
})

test('las facturas compartidas NO aparecen como propias; scope=shared las separa y las marca de solo lectura', async () => {
  const db = freshDb()
  await call(shares, 'POST', { user: 'u-B-owner', db, id: 'inv-B1', body: { brand_id: BRAND_A } })
  assert.deepEqual(ids(await call(list, 'GET', { user: 'u-A-owner', db })), ['inv-A1', 'inv-A2'])
  const shared = await call(list, 'GET', { user: 'u-A-owner', db, query: '?scope=shared' })
  assert.deepEqual(ids(shared), ['inv-B1'])
  assert.ok((shared.json.data as Row[]).every(i => i.read_only === true && i.access === 'shared' && !('owner_brand_id' in i)))
})

test('revocar el acceso compartido bloquea nuevas consultas de esa marca', async () => {
  const db = freshDb()
  await call(shares, 'POST', { user: 'u-B-owner', db, id: 'inv-B1', body: { brand_id: BRAND_A } })
  assert.equal((await call(one, 'GET', { user: 'u-A-owner', db, id: 'inv-B1' })).status, 200)
  const revoke = await call(shares, 'DELETE', { user: 'u-B-owner', db, id: 'inv-B1', query: `?brand_id=${BRAND_A}` })
  assert.equal(revoke.status, 200)
  assert.equal(db.invoice_shares[0].status, 'revoked')
  assert.equal(db.invoice_shares[0].revoked_by, 'u-B-owner')
  assert.equal((await call(one, 'GET', { user: 'u-A-owner', db, id: 'inv-B1' })).status, 404)
  assert.deepEqual(ids(await call(list, 'GET', { user: 'u-A-owner', db, query: '?scope=shared' })), [])
  // Re-compartir reactiva la misma fila.
  assert.equal((await call(shares, 'POST', { user: 'u-B-owner', db, id: 'inv-B1', body: { brand_id: BRAND_A } })).status, 201)
  assert.equal(db.invoice_shares.length, 1)
  assert.equal(db.invoice_shares[0].status, 'active')
  assert.equal(db.invoice_shares[0].revoked_at, null)
})

test('compartir con una marca no concede acceso a las demás; SCENCE comparte facturas sin propietario (solo lectura)', async () => {
  const db = freshDb()
  await call(shares, 'POST', { user: 'u-B-owner', db, id: 'inv-B1', body: { brand_id: BRAND_A } })
  assert.equal((await call(one, 'GET', { user: 'u-C-owner', db, id: 'inv-B1' })).status, 404)

  // Factura histórica sin propietario: la receptora la ve únicamente tras un compartido explícito.
  assert.equal((await call(one, 'GET', { user: 'u-A-owner', db, id: 'inv-legacy' })).status, 404)
  assert.equal((await call(shares, 'POST', { user: 'u-admin', db, id: 'inv-legacy', body: { brand_id: BRAND_A } })).status, 201)
  assert.equal((await call(one, 'GET', { user: 'u-A-owner', db, id: 'inv-legacy' })).status, 200)
  assert.equal((await call(one, 'PATCH', { user: 'u-A-owner', db, id: 'inv-legacy', body: { action: 'mark_paid' } })).status, 403)
})

test('un rol sin billing.read en la marca destinataria no ve la factura compartida', async () => {
  const db = freshDb()
  await call(shares, 'POST', { user: 'u-B-owner', db, id: 'inv-B1', body: { brand_id: BRAND_A } })
  assert.equal((await call(one, 'GET', { user: 'u-A-member', db, id: 'inv-B1' })).status, 404)
})

test('compartir: validaciones (propia marca, marca inexistente, UUID inválido)', async () => {
  const db = freshDb()
  assert.equal((await call(shares, 'POST', { user: 'u-B-owner', db, id: 'inv-B1', body: { brand_id: BRAND_B } })).status, 422)
  assert.equal((await call(shares, 'POST', { user: 'u-B-owner', db, id: 'inv-B1', body: { brand_id: U(99) } })).status, 404)
  assert.equal((await call(shares, 'POST', { user: 'u-B-owner', db, id: 'inv-B1', body: { brand_id: 'no-uuid' } })).status, 422)
  assert.equal(db.invoice_shares.length, 0)
})

// ── 12. Facturas de colaboración ───────────────────────────────────────────

test('colaboración: SCENCE confirma el pago y se activa la solicitud ligada a ESA factura', async () => {
  const db = freshDb()
  const r = await call(one, 'PATCH', { user: 'u-admin', db, id: 'inv-collab', body: { action: 'mark_paid' } })
  assert.equal(r.status, 200)
  assert.equal(db.campaign_brand_applications.find(a => a.id === 'app-1')!.status, 'active')
  assert.deepEqual(db.campaign_brands.map(b => [b.campaign_id, b.brand_id, b.role]), [['camp-A', BRAND_C, 'collaborator']])
})

test('colaboración: una factura no activa la solicitud de OTRA factura (invoice_id no coincide)', async () => {
  const db = freshDb()
  const r = await call(one, 'PATCH', { user: 'u-admin', db, id: 'inv-other', body: { action: 'mark_paid' } })
  assert.equal(r.status, 200)
  assert.equal(db.campaign_brand_applications.find(a => a.id === 'app-2')!.status, 'approved_for_payment')
  assert.equal(db.campaign_brands.length, 0)
})

test('colaboración: la marca (incluida la receptora) no puede confirmar el pago de una factura de SCENCE', async () => {
  const db = freshDb()
  const before = snapshot(db)
  assert.equal((await call(one, 'PATCH', { user: 'u-C-owner', db, id: 'inv-collab', body: { action: 'mark_paid' } })).status, 404)
  assert.deepEqual(snapshot(db), before)
  // Incluso con acceso compartido explícito: solo lectura.
  await call(shares, 'POST', { user: 'u-admin', db, id: 'inv-collab', body: { brand_id: BRAND_C } })
  assert.equal((await call(one, 'PATCH', { user: 'u-C-owner', db, id: 'inv-collab', body: { action: 'mark_paid' } })).status, 403)
  assert.equal(db.campaign_brand_applications.find(a => a.id === 'app-1')!.status, 'approved_for_payment')
  assert.equal(db.campaign_brands.length, 0)
})

// ── POST ────────────────────────────────────────────────────────────────────

const newInvoice = (over: Record<string, unknown> = {}) => ({
  campaign_id: 'camp-A', client_name: 'Cliente nuevo', issue_date: '2026-10-22', due_date: '2026-11-22',
  currency: 'CLP', tax_rate: 19, items: [{ description: 'Servicio', quantity: 2, unit_price: 1000 }], ...over,
})

test('POST: la marca crea facturas PROPIAS; la propiedad sale de la sesión, no del payload', async () => {
  const db = freshDb()
  const r = await call(list, 'POST', { user: 'u-A-owner', db, body: newInvoice() })
  assert.equal(r.status, 201)
  const created = db.invoices[db.invoices.length - 1]
  assert.equal(created.owner_brand_id, BRAND_A)
  assert.equal(created.organization_id, 'org-A', 'vive en la organización de la marca, no en la de la agencia')
  assert.equal(created.status, 'draft')
  assert.equal(created.issued_by, 'u-A-owner')
  assert.equal(created.subtotal, 2000)
  assert.equal(created.total, 2380)
  // y la ve en su listado
  assert.ok(ids(await call(list, 'GET', { user: 'u-A-owner', db })).includes(created.id))
})

test('POST: intentar asignar otra marca/organización como propietaria por payload → 403 y no escribe', async () => {
  for (const forged of [{ owner_brand_id: BRAND_B }, { brand_id: BRAND_B }, { organization_id: 'org-B' }]) {
    const db = freshDb()
    const before = snapshot(db)
    const r = await call(list, 'POST', { user: 'u-A-owner', db, body: newInvoice(forged) })
    assert.equal(r.status, 403, JSON.stringify(forged))
    assert.deepEqual(snapshot(db), before)
  }
})

test('POST: campaña ajena 403, sin campaña 422, sin billing.manage 403, ítems inválidos 422', async () => {
  const db = freshDb()
  const before = snapshot(db)
  assert.equal((await call(list, 'POST', { user: 'u-A-owner', db, body: newInvoice({ campaign_id: 'camp-B' }) })).status, 403)
  assert.equal((await call(list, 'POST', { user: 'u-A-owner', db, body: newInvoice({ campaign_id: undefined }) })).status, 422)
  assert.equal((await call(list, 'POST', { user: 'u-A-member', db, body: newInvoice() })).status, 403)
  assert.equal((await call(list, 'POST', { user: 'u-A-owner', db, body: newInvoice({ items: [{ quantity: -1, unit_price: 10 }] }) })).status, 422)
  assert.equal((await call(list, 'POST', { user: 'u-A-owner', db, body: newInvoice({ tax_rate: 500 }) })).status, 422)
  assert.equal((await call(list, 'POST', { user: 'u-A-owner', db, body: newInvoice({ items: [{ quantity: 'abc', unit_price: 10 }] }) })).status, 422)
  assert.deepEqual(snapshot(db), before)
})

test('POST: SCENCE crea facturas sin propietario de marca (emisión SCENCE)', async () => {
  const db = freshDb()
  const r = await call(list, 'POST', { user: 'u-admin', db, body: newInvoice({ campaign_id: 'camp-B' }) })
  assert.equal(r.status, 201)
  const created = db.invoices[db.invoices.length - 1]
  assert.equal(created.owner_brand_id, null)
  assert.equal(created.organization_id, 'org-agency')
})
