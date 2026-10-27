import test from 'node:test'
import assert from 'node:assert/strict'
import { resolvePhysicalLocation, PhysicalLocationError } from '../src/lib/resolvePhysicalLocation.ts'

const ID = '11111111-1111-4111-8111-111111111111'
const stub = (place: Record<string, unknown> | null) => ({
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: place, error: null }) }) }) }),
  rpc: async () => ({ data: [{ level: 'country', name: 'Chile' }, { level: 'commune', name: 'Providencia' }, { level: 'place', name: 'Sede' }], error: null }),
}) as never

test('virtual no guarda lugar', async () => {
  assert.deepEqual(await resolvePhysicalLocation(stub(null), { locationId: ID, isVirtual: true }), { locationId: null, locationDisplay: null })
})
test('sin location_id conserva el texto', async () => {
  assert.deepEqual(await resolvePhysicalLocation(stub(null), { location: ' Café ' }), { locationId: null, locationDisplay: 'Café' })
})
test('place válido deriva el texto con la geografía', async () => {
  const r = await resolvePhysicalLocation(stub({ id: ID, level: 'place', name: 'Sede', address: 'Av 1', type: 'event', is_private: false, is_active: true }), { locationId: ID })
  assert.equal(r.locationId, ID)
  assert.equal(r.locationDisplay, 'Sede — Chile · Providencia — Av 1')
})
test('rechaza no-place, domicilio privado, inexistente e id inválido', async () => {
  await assert.rejects(resolvePhysicalLocation(stub({ id: ID, level: 'commune', name: 'x' }), { locationId: ID }), PhysicalLocationError)
  await assert.rejects(resolvePhysicalLocation(stub({ id: ID, level: 'place', name: 'x', type: 'influencer_home', is_private: true }), { locationId: ID }), PhysicalLocationError)
  await assert.rejects(resolvePhysicalLocation(stub(null), { locationId: ID }), PhysicalLocationError)
  await assert.rejects(resolvePhysicalLocation(stub(null), { locationId: 'x' }), PhysicalLocationError)
})
