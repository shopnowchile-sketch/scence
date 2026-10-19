// Ejecuta los handlers REALES de POST/PATCH/DELETE de /api/influencer/my-campaigns
// contra una base EN MEMORIA con datos ficticios (tests/support/memory-supabase.ts).
// Sin .env.local, sin red, sin Supabase, sin producción.
//
// LÍMITES (no se prueba aquí): RLS, restricciones/tipos reales de PostgreSQL (p. ej. el enum
// campaign_status), joins de PostgREST (los select con relaciones devuelven filas planas),
// el GET, la UI ni el comportamiento visual en localhost:3000.
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('./support/ts-resolve.mjs', import.meta.url)
register('./support/route-harness.mjs', import.meta.url)

const { makeAdmin } = await import('./support/memory-supabase.ts')
const route = await import('../src/app/api/influencer/my-campaigns/route.ts')

type Row = Record<string, any>
type Db = Record<string, Row[]>

function freshDb(): Db {
  return {
    influencers: [
      { id: 'inf-A', user_id: 'user-A', organization_id: 'org-1' },
      { id: 'inf-B', user_id: 'user-B', organization_id: 'org-1' },
      { id: 'inf-sinorg', user_id: 'user-N', organization_id: null },
    ],
    brands: [{ id: 'brand-X', name: 'Marca ficticia X', contact_email: 'x@ficticio.test' }],
    campaigns: [
      { id: 'camp-A', name: 'Propia de A', created_by: 'user-A', organization_id: 'org-1', brand_id: null, status: 'active', start_date: '2026-10-10', end_date: '2026-10-20' },
      { id: 'camp-B', name: 'Propia de B', created_by: 'user-B', organization_id: 'org-1', brand_id: null, status: 'active', start_date: null, end_date: null },
      { id: 'camp-brand', name: 'De la marca X', created_by: 'user-brand', organization_id: 'org-1', brand_id: 'brand-X', status: 'active', start_date: null, end_date: null },
    ],
    campaign_influencers: [],
    campaign_deliverables: [{ id: 'del-B', campaign_id: 'camp-B', title: 'Entregable de B', status: 'pending' }],
  }
}

const snapshot = (db: Db) => JSON.parse(JSON.stringify(db))

async function call(
  handler: 'POST' | 'PATCH' | 'DELETE',
  body: unknown,
  opts: { user?: string | null; db?: Db; fail?: Record<string, string> } = {},
) {
  const db = opts.db ?? freshDb()
  const user = opts.user === undefined ? 'user-A' : opts.user
  ;(globalThis as any).__routeHarness = {
    user: user ? { id: user } : null,
    admin: makeAdmin(db, { autoId: true, ...(opts.fail ?? {}) }),
  }
  const req = { json: async () => body } as any
  const res = await (route as any)[handler](req)
  return { status: res.status as number, json: (await res.json()) as any, db }
}

const campaign = (db: Db, id: string) => db.campaigns.find(c => c.id === id)

// ── Autenticación ───────────────────────────────────────────────────────────

test('sin sesión: POST, PATCH y DELETE responden 401 y no escriben', async () => {
  for (const [h, body] of [['POST', { name: 'X' }], ['PATCH', { id: 'camp-A', name: 'Y' }], ['DELETE', { id: 'camp-A' }]] as const) {
    const before = snapshot(freshDb())
    const r = await call(h, body, { user: null })
    assert.equal(r.status, 401, h)
    assert.deepEqual(snapshot(r.db), before, `${h} no debe escribir`)
  }
})

test('usuario que no es influencer: 403 y no escribe', async () => {
  for (const [h, body] of [['POST', { name: 'X' }], ['PATCH', { id: 'camp-A', name: 'Y' }], ['DELETE', { id: 'camp-A' }]] as const) {
    const before = snapshot(freshDb())
    const r = await call(h, body, { user: 'user-brand' })
    assert.equal(r.status, 403, h)
    assert.deepEqual(snapshot(r.db), before, `${h} no debe escribir`)
  }
})

// ── POST ────────────────────────────────────────────────────────────────────

test('POST ok: campaña propia asociada a la usuaria correcta y vínculo accepted', async () => {
  const r = await call('POST', { name: '  Verano  ', description: 'brief', start_date: '2026-11-01', end_date: '2026-11-30' })
  assert.equal(r.status, 201)
  assert.equal(r.json.data._self_created, true)
  assert.equal(r.db.campaigns.length, 4)
  const c = r.db.campaigns[3]
  assert.equal(c.name, 'Verano')
  assert.equal(c.created_by, 'user-A')
  assert.equal(c.organization_id, 'org-1')
  assert.equal(c.status, 'active')
  assert.equal(c.type, 'sponsored_post')
  assert.equal(c.brand_id, null)
  assert.equal(r.db.campaign_influencers.length, 1)
  const link = r.db.campaign_influencers[0]
  assert.equal(link.campaign_id, c.id)
  assert.equal(link.influencer_id, 'inf-A')
  assert.equal(link.application_status, 'accepted')
  assert.equal('status' in link, false, 'campaign_influencers.status nunca se escribe (CLAUDE.md 16.1)')
})

test('POST: brand_id y status del body se ignoran', async () => {
  const r = await call('POST', { name: 'X', brand_id: 'brand-X', status: 'completed' })
  assert.equal(r.status, 201)
  const c = r.db.campaigns[3]
  assert.equal(c.brand_id, null)
  assert.equal(c.status, 'active')
  assert.equal(r.json.data.campaign.brand_id, null)
})

test('POST: validaciones rechazan con 400 y no escriben', async () => {
  const bad: unknown[] = [
    {}, { name: '   ' }, { name: 7 }, { name: 'a'.repeat(121) },
    { name: 'X', start_date: '2026-13-40' },
    { name: 'X', start_date: '2026-11-10', end_date: '2026-11-01' },
    { name: 'X', currency: 'no-es-moneda' },
    { name: 'X', fee: -5 },
  ]
  for (const body of bad) {
    const before = snapshot(freshDb())
    const r = await call('POST', body)
    assert.equal(r.status, 400, JSON.stringify(body))
    assert.deepEqual(snapshot(r.db), before)
  }
})

test('POST: influencer sin organización → 400 y no escribe', async () => {
  const before = snapshot(freshDb())
  const r = await call('POST', { name: 'X' }, { user: 'user-N' })
  assert.equal(r.status, 400)
  assert.deepEqual(snapshot(r.db), before)
})

test('POST: si falla el vínculo se deshace la campaña y responde 500', async () => {
  const r = await call('POST', { name: 'X' }, { fail: { failInsertOn: 'campaign_influencers' } })
  assert.equal(r.status, 500)
  assert.equal(r.db.campaigns.length, 3, 'la campaña creada se deshizo')
  assert.equal(r.db.campaign_influencers.length, 0)
})

test('POST: si falla el insert de la campaña responde 500 y no crea vínculo', async () => {
  const r = await call('POST', { name: 'X' }, { fail: { failInsertOn: 'campaigns' } })
  assert.equal(r.status, 500)
  assert.equal(r.db.campaign_influencers.length, 0)
})

// ── PATCH ───────────────────────────────────────────────────────────────────

test('PATCH: id obligatorio, campaña inexistente → 400 / 404', async () => {
  assert.equal((await call('PATCH', { name: 'X' })).status, 400)
  assert.equal((await call('PATCH', { id: 'no-existe', name: 'X' })).status, 404)
})

test('PATCH: no puede modificar campañas ajenas (de otra influencer ni de una marca)', async () => {
  for (const id of ['camp-B', 'camp-brand']) {
    const before = snapshot(freshDb())
    const r = await call('PATCH', {
      id, name: 'Hackeada', status: 'canceled', brand_id: 'brand-X',
      deliverables: [{ title: 'Colado', type: 'reel' }, { id: 'del-B', title: 'Cambiado' }, { id: 'del-B', _delete: true }],
    })
    assert.equal(r.status, 403, id)
    assert.deepEqual(snapshot(r.db), before, `${id} no debe cambiar (ni campaña ni entregables)`)
  }
})

test('PATCH propia: actualiza campos permitidos e ignora brand_id', async () => {
  const r = await call('PATCH', { id: 'camp-A', name: ' Nuevo ', description: 'd', brand_id: 'brand-X' })
  assert.equal(r.status, 200)
  const c = campaign(r.db, 'camp-A')!
  assert.equal(c.name, 'Nuevo')
  assert.equal(c.description, 'd')
  assert.equal(c.brand_id, null, 'brand_id no se puede asignar')
})

test('PATCH propia: estados permitidos pasan; activar/borrador/revisión se rechazan sin escribir', async () => {
  for (const status of ['paused', 'completed', 'canceled']) {
    const r = await call('PATCH', { id: 'camp-A', status })
    assert.equal(r.status, 200, status)
    assert.equal(campaign(r.db, 'camp-A')!.status, status)
  }
  for (const status of ['active', 'draft', 'pending_approval', 'inactive']) {
    const before = snapshot(freshDb())
    const r = await call('PATCH', { id: 'camp-A', status })
    assert.equal(r.status, 400, status)
    assert.deepEqual(snapshot(r.db), before)
  }
})

test('PATCH propia: valida fechas contra las guardadas (fin < inicio → 400)', async () => {
  const before = snapshot(freshDb())
  const r = await call('PATCH', { id: 'camp-A', end_date: '2026-10-01' })
  assert.equal(r.status, 400)
  assert.deepEqual(snapshot(r.db), before)
})

test('PATCH propia: agrega, actualiza y borra entregables SOLO de su campaña', async () => {
  const db = freshDb()
  db.campaign_deliverables.push({ id: 'del-A', campaign_id: 'camp-A', title: 'Viejo', status: 'pending' })
  const r = await call('PATCH', {
    id: 'camp-A',
    deliverables: [
      { title: 'Nuevo reel', type: 'reel', platform: 'Instagram', status: 'pending' },
      { id: 'del-A', title: 'Editado' },
      { id: 'del-B', title: 'Intento sobre entregable ajeno' },
      { id: 'del-B', _delete: true },
    ],
  }, { db })
  assert.equal(r.status, 200)
  assert.equal(r.db.campaign_deliverables.find(d => d.id === 'del-A')!.title, 'Editado')
  assert.ok(r.db.campaign_deliverables.some(d => d.title === 'Nuevo reel' && d.campaign_id === 'camp-A' && d.influencer_id === 'inf-A' && d.platform === 'instagram'))
  const b = r.db.campaign_deliverables.find(d => d.id === 'del-B')
  assert.ok(b, 'el entregable de otra campaña no se borra')
  assert.equal(b!.title, 'Entregable de B', 'ni se edita')
})

test('PATCH: errores de escritura se informan con 500 (no se ignoran)', async () => {
  const cases: Array<[string, unknown, Record<string, string>]> = [
    ['update de campaña', { id: 'camp-A', name: 'X' }, { failUpdateOn: 'campaigns' }],
    ['insert de entregable', { id: 'camp-A', deliverables: [{ title: 'N' }] }, { failInsertOn: 'campaign_deliverables' }],
    ['update de entregable', { id: 'camp-A', deliverables: [{ id: 'del-A', title: 'E' }] }, { failUpdateOn: 'campaign_deliverables' }],
    ['delete de entregable', { id: 'camp-A', deliverables: [{ id: 'del-A', _delete: true }] }, { failDeleteOn: 'campaign_deliverables' }],
  ]
  for (const [label, body, fail] of cases) {
    const db = freshDb()
    db.campaign_deliverables.push({ id: 'del-A', campaign_id: 'camp-A', title: 'Viejo', status: 'pending' })
    const r = await call('PATCH', body, { db, fail })
    assert.equal(r.status, 500, label)
    assert.ok(typeof r.json.error === 'string' && r.json.error.length > 0, label)
  }
})

// ── DELETE ──────────────────────────────────────────────────────────────────

test('DELETE: id obligatorio y campaña inexistente → 400 / 404', async () => {
  assert.equal((await call('DELETE', {})).status, 400)
  assert.equal((await call('DELETE', { id: 'no-existe' })).status, 404)
})

test('DELETE: no puede cancelar campañas ajenas', async () => {
  for (const id of ['camp-B', 'camp-brand']) {
    const before = snapshot(freshDb())
    const r = await call('DELETE', { id })
    assert.equal(r.status, 403, id)
    assert.deepEqual(snapshot(r.db), before)
  }
})

test('DELETE propia: cancela (soft delete), no borra la fila', async () => {
  const r = await call('DELETE', { id: 'camp-A' })
  assert.equal(r.status, 200)
  assert.equal(r.json.ok, true)
  assert.equal(campaign(r.db, 'camp-A')!.status, 'canceled')
  assert.equal(r.db.campaigns.length, 3)
})

test('DELETE: si falla la escritura responde 500 y la campaña no cambia', async () => {
  const r = await call('DELETE', { id: 'camp-A' }, { fail: { failUpdateOn: 'campaigns' } })
  assert.equal(r.status, 500)
  assert.equal(campaign(r.db, 'camp-A')!.status, 'active')
})
