// PUT /api/bookings: lista blanca de columnas, validación de tipos y autorización por propiedad.
// Antes `...rest` mandaba el body completo al UPDATE (influencer_id, confirmation_token/status, internal_notes,
// metadata, fee/currency...). Handlers reales sobre base en memoria; sin red ni producción.
// LÍMITE: no prueba Google Calendar (desactivado por defecto) ni el RLS real de la tabla `bookings`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('./support/ts-resolve.mjs', import.meta.url)
register('./support/route-harness.mjs', import.meta.url)
const { makeAdmin } = await import('./support/memory-supabase.ts')

type Row = Record<string, any>
const m = (user_id: string, organization_id: string, role: string, brand_id: string | null, is_owner = false, is_active = true) =>
  ({ id: `m-${user_id}-${organization_id}`, user_id, organization_id, role, brand_id, is_owner, is_active })
const booking = (id: string, organization_id: string, campaign_id: string | null, extra: Row = {}): Row => ({
  id, organization_id, campaign_id, event_type: 'shoot', influencer_id: 'inf-1', created_by: 'uCreator',
  title: 'Original', description: 'desc', status: 'proposed', location: 'Lugar', location_details: {},
  starts_at: '2026-12-01T10:00:00.000Z', ends_at: '2026-12-01T12:00:00.000Z',
  confirmation_token: 'tok-secreto', confirmation_status: 'pending', confirmed_at: null, canceled_at: null,
  internal_notes: 'solo-interno', fee: 1000, currency: 'CLP', travel_budget: 50, wardrobe_provided: false,
  calendar_event_id: 'gcal-1', metadata: { k: 1 }, notes: null, is_virtual: false, virtual_link: null, travel_covered: false,
  ...extra,
})
const fresh = (): Record<string, Row[]> => ({
  brands: [
    { id: 'brand-A', organization_id: 'org-A', status: 'approved' },
    { id: 'brand-B', organization_id: 'org-B', status: 'approved' },
  ],
  organization_members: [
    m('uOwnerA', 'org-A', 'brand_manager', 'brand-A', true), m('uMemA', 'org-A', 'member', 'brand-A'),
    m('uFinA', 'org-A', 'finance', 'brand-A'),
    m('uMgrB', 'org-B', 'brand_manager', 'brand-B'),
    m('uAdmin', 'org-adm', 'super_admin', null),
    m('uExAdmin', 'org-adm', 'super_admin', null, false, false), m('uExAdmin', 'org-B', 'brand_manager', 'brand-B'),
    m('uInfl', 'org-A', 'influencer', null),
  ],
  campaigns: [
    { id: 'camp-A', name: 'A', organization_id: 'org-A', brand_id: 'brand-A', created_by_brand_id: null, type: 'ugc', status: 'active', metadata: {} },
    { id: 'camp-B', name: 'B', organization_id: 'org-B', brand_id: 'brand-B', created_by_brand_id: null, type: 'ugc', status: 'active', metadata: {} },
  ],
  campaign_brands: [], campaign_locations: [], locations: [],
  bookings: [
    booking('bk-A', 'org-A', 'camp-A'),
    booking('bk-B', 'org-B', 'camp-B'),
    booking('bk-N', 'org-adm', null),
  ],
})
const as = (user: string | null) => {
  const db = fresh()
  ;(globalThis as any).__routeHarness = { user: user ? { id: user, user_metadata: {} } : null, admin: makeAdmin(db, { signedBrandFixtures: true }) }
  return db
}
const put = (body: unknown) => ({ url: 'http://x/api/bookings', json: async () => body, headers: new Headers(), nextUrl: new URL('http://x/api/bookings') }) as any
const { PUT } = await import('../src/app/api/bookings/route.ts')
const row = (db: Record<string, Row[]>, id: string) => db.bookings.find(b => b.id === id)!

test('sin sesión → 401', async () => {
  as(null)
  assert.equal((await PUT(put({ id: 'bk-A', title: 'x' }))).status, 401)
})

test('campos permitidos se actualizan (título, descripción, fechas, estado, notas) y no se pierde lo demás', async () => {
  const db = as('uAdmin')
  const res = await PUT(put({
    id: 'bk-A', title: 'Nuevo', description: 'otra', starts_at: '2026-12-02T10:00:00.000Z', ends_at: '2026-12-02T11:00:00.000Z',
    timezone: 'America/Santiago', status: 'confirmed', notes: 'n', is_virtual: true, virtual_link: 'https://meet', travel_covered: true,
  }))
  assert.equal(res.status, 200)
  const b = row(db, 'bk-A')
  assert.equal(b.title, 'Nuevo'); assert.equal(b.description, 'otra'); assert.equal(b.status, 'confirmed')
  assert.equal(b.starts_at, '2026-12-02T10:00:00.000Z'); assert.equal(b.ends_at, '2026-12-02T11:00:00.000Z')
  assert.equal(b.notes, 'n'); assert.equal(b.is_virtual, true); assert.equal(b.virtual_link, 'https://meet'); assert.equal(b.travel_covered, true)
  assert.equal(b.organization_id, 'org-A'); assert.equal(b.confirmation_token, 'tok-secreto')
  assert.ok(typeof b.updated_at === 'string')
})

test('pantalla de reservas: PUT {id, status:"confirmed"} sigue funcionando', async () => {
  const db = as('uAdmin')
  assert.equal((await PUT(put({ id: 'bk-A', status: 'confirmed' }))).status, 200)
  assert.equal(row(db, 'bk-A').status, 'confirmed')
  assert.equal(row(db, 'bk-A').title, 'Original')
})

test('campos NO autorizados se ignoran (propiedad, creador, influencer, tokens, estados internos, metadata)', async () => {
  for (const user of ['uAdmin', 'uOwnerA']) {
    const db = as(user)
    const before = { ...row(db, 'bk-A') }
    const res = await PUT(put({
      id: 'bk-A', title: 'Permitido',
      organization_id: 'org-B', campaign_id: 'camp-B', created_by: 'uAtacante', calendar_event_id: 'gcal-x',
      influencer_id: 'inf-evil', event_type: 'meeting',
      confirmation_token: 'tok-nuevo', confirmation_status: 'confirmed', confirmed_at: '2026-01-01T00:00:00Z',
      canceled_at: '2026-01-01T00:00:00Z', cancellation_reason: 'x', wardrobe_provided: true,
      metadata: { owned: true }, id_extra: 1, created_at: '2000-01-01', updated_by: 'x',
    }))
    assert.equal(res.status, 200, user)
    const after = row(db, 'bk-A')
    assert.equal(after.title, 'Permitido')
    for (const k of Object.keys(before)) {
      if (['title', 'updated_at'].includes(k)) continue
      assert.deepEqual(after[k], before[k], `${user}: ${k} no debe cambiar`)
    }
    for (const k of ['id_extra', 'updated_by', 'cancellation_reason']) assert.ok(!(k in after), `${user}: ${k} no debe escribirse`)
  }
})

test('fee, currency, travel_budget e internal_notes: el admin de plataforma los edita', async () => {
  const db = as('uAdmin')
  const res = await PUT(put({ id: 'bk-A', fee: 250000.5, currency: 'USD', travel_budget: 0, internal_notes: 'nota interna nueva' }))
  assert.equal(res.status, 200)
  const b = row(db, 'bk-A')
  assert.equal(b.fee, 250000.5); assert.equal(b.currency, 'USD'); assert.equal(b.travel_budget, 0); assert.equal(b.internal_notes, 'nota interna nueva')
  assert.equal(b.title, 'Original'); assert.equal(b.status, 'proposed')
  // null limpia el valor
  assert.equal((await PUT(put({ id: 'bk-A', fee: null, travel_budget: null, internal_notes: null }))).status, 200)
  assert.equal(row(db, 'bk-A').fee, null); assert.equal(row(db, 'bk-A').internal_notes, null)
})

test('fee, currency, travel_budget, internal_notes y status: una marca con permiso sobre la campaña recibe 403 y no se escribe nada', async () => {
  for (const user of ['uOwnerA', 'uMemA']) {
    for (const patch of [{ fee: 1 }, { currency: 'USD' }, { travel_budget: 5 }, { internal_notes: 'x' }, { status: 'confirmed' }, { title: 'mezcla', fee: 9 }]) {
      const db = as(user)
      const before = JSON.stringify(row(db, 'bk-A'))
      const res = await PUT(put({ id: 'bk-A', ...patch }))
      assert.equal(res.status, 403, `${user} ${JSON.stringify(patch)}`)
      assert.equal(JSON.stringify(row(db, 'bk-A')), before, `${user} ${JSON.stringify(patch)}`)
    }
  }
})

test('el estado cambia por su flujo: cancelar NO va por PUT (usar DELETE, que fija canceled_at); confirmar/completar sí, solo el admin', async () => {
  const db = as('uAdmin')
  const res = await PUT(put({ id: 'bk-A', status: 'canceled' }))
  assert.equal(res.status, 422)
  assert.equal(row(db, 'bk-A').status, 'proposed'); assert.equal(row(db, 'bk-A').canceled_at, null)
  for (const status of ['confirmed', 'completed', 'no_show', 'proposed']) {
    assert.equal((await PUT(put({ id: 'bk-A', status }))).status, 200, status)
    assert.equal(row(db, 'bk-A').status, status)
  }
  // confirmación/rechazo de la influencer y token no se tocan desde PUT
  assert.equal(row(db, 'bk-A').confirmation_status, 'pending'); assert.equal(row(db, 'bk-A').confirmation_token, 'tok-secreto')
})

test('tipos inválidos → 422 y no se escribe nada', async () => {
  const bad: Row[] = [
    { title: '' }, { title: 5 }, { status: 'canceled' }, { fee: -1 }, { fee: '10' }, { fee: Infinity }, { currency: 'XXX' }, { currency: 5 }, { travel_budget: -5 }, { travel_budget: '1' }, { internal_notes: 5 }, { internal_notes: 'x'.repeat(5001) }, { title: 'x'.repeat(201) }, { description: 7 }, { status: 'hackeado' }, { status: 3 },
    { starts_at: 'no-es-fecha' }, { ends_at: 123 }, { is_virtual: 'si' }, { travel_covered: 1 }, { virtual_link: {} }, { notes: [] },
    { location: 5 }, { location_id: 5 }, { location_details: [] }, { location_details: 'x' }, { timezone: 5 },
    { starts_at: '2026-12-03T10:00:00.000Z', ends_at: '2026-12-03T09:00:00.000Z' },
    { ends_at: '2026-11-30T10:00:00.000Z' }, // anterior al inicio ya guardado
  ]
  for (const patch of bad) {
    const db = as('uAdmin')
    const before = JSON.stringify(row(db, 'bk-A'))
    const res = await PUT(put({ id: 'bk-A', ...patch }))
    assert.equal(res.status, 422, JSON.stringify(patch))
    assert.equal(JSON.stringify(row(db, 'bk-A')), before, JSON.stringify(patch))
  }
})

test('id ausente o con tipo inválido → 400; cuerpo no objeto → 400; reserva inexistente → 404', async () => {
  as('uAdmin')
  assert.equal((await PUT(put({ title: 'x' }))).status, 400)
  assert.equal((await PUT(put({ id: { $ne: null } }))).status, 400)
  assert.equal((await PUT(put(null))).status, 400)
  assert.equal((await PUT(put([]))).status, 400)
  assert.equal((await PUT(put({ id: 'no-existe', title: 'x' }))).status, 404)
})

test('propiedad: quién puede editar una reserva de campaña (owner/member de la marca dueña sí; finance, otra marca, admin inactivo e influencer no)', async () => {
  for (const u of ['uOwnerA', 'uMemA']) {
    const db = as(u)
    assert.equal((await PUT(put({ id: 'bk-A', title: 'ok' }))).status, 200, u)
    assert.equal(row(db, 'bk-A').title, 'ok')
  }
  for (const u of ['uFinA', 'uMgrB', 'uExAdmin', 'uInfl']) {
    const db = as(u)
    assert.equal((await PUT(put({ id: 'bk-A', title: 'hack', status: 'confirmed' }))).status, 403, u)
    assert.equal(row(db, 'bk-A').title, 'Original', u)
    assert.equal(row(db, 'bk-A').status, 'proposed', u)
  }
})

test('una marca no edita reservas de OTRA marca aunque cambie organization_id/campaign_id en el body', async () => {
  const db = as('uMgrB')
  assert.equal((await PUT(put({ id: 'bk-A', title: 'hack', organization_id: 'org-B', campaign_id: 'camp-B' }))).status, 403)
  assert.equal(row(db, 'bk-A').title, 'Original')
  assert.equal(row(db, 'bk-A').organization_id, 'org-A')
})

test('reserva sin campaña: solo admin de plataforma activo (marca dueña de otra org y admin inactivo → 403)', async () => {
  const ok = as('uAdmin')
  assert.equal((await PUT(put({ id: 'bk-N', title: 'ok' }))).status, 200)
  assert.equal(row(ok, 'bk-N').title, 'ok')
  for (const u of ['uOwnerA', 'uMemA', 'uMgrB', 'uExAdmin', 'uInfl']) {
    const db = as(u)
    assert.equal((await PUT(put({ id: 'bk-N', title: 'hack' }))).status, 403, u)
    assert.equal(row(db, 'bk-N').title, 'Original', u)
  }
})

test('si el UPDATE falla en la base, responde 500 (no éxito silencioso)', async () => {
  const db = fresh()
  ;(globalThis as any).__routeHarness = { user: { id: 'uAdmin', user_metadata: {} }, admin: makeAdmin(db, { signedBrandFixtures: true, failUpdateOn: 'bookings' }) }
  const res = await PUT(put({ id: 'bk-A', title: 'x' }))
  assert.equal(res.status, 500)
  assert.equal(db.bookings.find(b => b.id === 'bk-A')!.title, 'Original')
})
