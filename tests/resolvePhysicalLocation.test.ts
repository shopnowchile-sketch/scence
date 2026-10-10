import test from 'node:test'
import assert from 'node:assert/strict'
import { PhysicalLocationError, resolvePhysicalLocation } from '../src/lib/resolvePhysicalLocation.ts'

function mockAdmin(place: Record<string, unknown> | null, breadcrumb: unknown[] = []) {
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({ data: place, error: null }),
              }
            },
          }
        },
      }
    },
    rpc: async () => ({ data: breadcrumb, error: null }),
  } as never
}

test('virtual locations resolve to null', async () => {
  const result = await resolvePhysicalLocation(mockAdmin(null), {
    isVirtual: true,
    location: 'ignored',
  })
  assert.deepEqual(result, { locationId: null, locationDisplay: null, status: 'virtual' })
})

test('missing location remains pending without guessing', async () => {
  const result = await resolvePhysicalLocation(mockAdmin(null), {
    location: 'Dirección legacy',
  })
  assert.deepEqual(result, { locationId: null, locationDisplay: 'Dirección legacy', status: 'pending' })
})

test('invalid location id is rejected', async () => {
  await assert.rejects(
    () => resolvePhysicalLocation(mockAdmin(null), { locationId: 'not-a-uuid' }),
    (error: unknown) => error instanceof PhysicalLocationError && error.status === 400,
  )
})

test('non-place location id is rejected', async () => {
  await assert.rejects(
    () => resolvePhysicalLocation(
      mockAdmin({ id: '11111111-1111-4111-8111-111111111111', level: 'commune', name: 'Las Condes', address: null }),
      { locationId: '11111111-1111-4111-8111-111111111111' },
    ),
    (error: unknown) => error instanceof PhysicalLocationError && error.status === 422,
  )
})

test('place location id resolves to canonical display', async () => {
  const id = '11111111-1111-4111-8111-111111111111'
  const result = await resolvePhysicalLocation(
    mockAdmin({ id, level: 'place', name: 'Agencia', address: 'Evaristo Lillo 178' }, [
      { id: 'c', level: 'country', name: 'Chile' },
      { id: 'r', level: 'region', name: 'Región Metropolitana' },
      { id: 'm', level: 'commune', name: 'Las Condes' },
      { id, level: 'place', name: 'Agencia' },
    ]),
    { locationId: id },
  )
  assert.equal(result.status, 'resolved')
  assert.equal(result.locationId, id)
  assert.equal(result.locationDisplay, 'Agencia — Chile · Región Metropolitana · Las Condes — Evaristo Lillo 178')
})
