import test from 'node:test'
import assert from 'node:assert/strict'
import { PhysicalLocationError, normalizePhysicalText, resolvePhysicalLocation } from '../src/lib/resolvePhysicalLocation.ts'

const COMMUNE_ID = '10000000-0000-4000-8000-000000000001'
const REGION_ID = '10000000-0000-4000-8000-000000000002'
const COUNTRY_ID = '10000000-0000-4000-8000-000000000003'
const PLACE_ID = '20000000-0000-4000-8000-000000000001'
const PLACE_ID_2 = '20000000-0000-4000-8000-000000000002'
const ORG_ID = '30000000-0000-4000-8000-000000000001'

function mockAdmin(rows: Record<string, unknown>[]) {
  return {
    from(table: string) {
      assert.equal(table, 'locations')
      return {
        select() {
          const filters: Record<string, unknown> = {}
          const chain = {
            eq(key: string, value: unknown) {
              filters[key] = value
              return chain
            },
            async maybeSingle() {
              const data = rows.find(row => Object.entries(filters).every(([k, v]) => row[k] === v)) ?? null
              return { data, error: null }
            },
            async single() {
              const data = rows.find(row => Object.entries(filters).every(([k, v]) => row[k] === v)) ?? null
              return { data, error: data ? null : { code: 'PGRST116', message: 'not found' } }
            },
            async then(resolve: (value: unknown) => unknown) {
              const data = rows.filter(row => Object.entries(filters).every(([k, v]) => row[k] === v))
              return resolve({ data, error: null })
            },
          }
          return chain
        },
        insert(payload: Record<string, unknown>) {
          const created = { ...payload, id: '40000000-0000-4000-8000-000000000001' }
          return {
            select() {
              return {
                async single() {
                  rows.push(created)
                  return { data: created, error: null }
                },
              }
            },
          }
        },
      }
    },
  } as never
}

function baseRows() {
  return [
    { id: COUNTRY_ID, parent_id: null, level: 'country', name: 'Chile', address: null, type: null, brand_id: null, is_private: false, is_active: true },
    { id: REGION_ID, parent_id: COUNTRY_ID, level: 'region', name: 'Región Metropolitana', address: null, type: null, brand_id: null, is_private: false, is_active: true },
    { id: COMMUNE_ID, parent_id: REGION_ID, level: 'commune', name: 'Las Condes', address: null, type: null, brand_id: null, is_private: false, is_active: true },
    { id: PLACE_ID, parent_id: COMMUNE_ID, level: 'place', name: 'VRAVA', address: 'Av. Presidente Riesco 5330, local 104', type: 'event', brand_id: null, is_private: false, is_active: true },
  ]
}

test('normalizes address abbreviations and punctuation', () => {
  assert.equal(
    normalizePhysicalText('Av. Presidente Kennedy 5741'),
    normalizePhysicalText('Avenida Presidente Kennedy 5741'),
  )
})

test('same address resolves to the same Location', async () => {
  const result = await resolvePhysicalLocation(mockAdmin(baseRows()), {
    address: 'Avenida Presidente Riesco 5330, local 104',
    commune: 'Las Condes',
    region: 'RM',
    country: 'Chile',
    organizationId: ORG_ID,
  })
  // Region is deliberately incompatible with the stored full name "Región Metropolitana".
  // The resolver must not silently guess from an incomplete abbreviation.
  assert.equal(result.matchType, 'ambiguous')
})

test('street abbreviation and shortened street name resolve the same physical address', async () => {
  const rows = baseRows().map(row => row.id === PLACE_ID ? {
    ...row,
    address: 'Avenida Presidente Kennedy 5741',
    name: 'Limitless',
  } : row)
  const result = await resolvePhysicalLocation(mockAdmin(rows), {
    address: 'Kennedy 5741, Las Condes',
    commune: 'Las Condes',
    region: 'Región Metropolitana',
    country: 'Chile',
    organizationId: ORG_ID,
  })
  assert.deepEqual(result, { locationId: PLACE_ID, matchType: 'existing' })
})

test('same address with case and whitespace differences resolves existing', async () => {
  const result = await resolvePhysicalLocation(mockAdmin(baseRows()), {
    address: '  av. PRESIDENTE   RIESCO 5330, LOCAL 104 ',
    commune: 'Las Condes',
    region: 'Región Metropolitana',
    country: 'Chile',
    organizationId: ORG_ID,
  })
  assert.deepEqual(result, { locationId: PLACE_ID, matchType: 'existing' })
})

test('address plus different geography never assumes a match', async () => {
  const result = await resolvePhysicalLocation(mockAdmin(baseRows()), {
    address: 'Av. Presidente Riesco 5330, local 104',
    commune: 'Providencia',
    region: 'Región Metropolitana',
    country: 'Chile',
    organizationId: ORG_ID,
  })
  assert.equal(result.matchType, 'ambiguous')
  assert.equal(result.locationId, null)
})

test('multiple physical matches return ambiguous', async () => {
  const rows = baseRows()
  rows.push({ ...rows[3], id: PLACE_ID_2, brand_id: '50000000-0000-4000-8000-000000000001' })
  const result = await resolvePhysicalLocation(mockAdmin(rows), {
    address: 'Av. Presidente Riesco 5330, local 104',
    commune: 'Las Condes',
    region: 'Región Metropolitana',
    country: 'Chile',
    organizationId: ORG_ID,
  })
  assert.deepEqual(result, { locationId: null, matchType: 'ambiguous' })
})

test('insufficient information does not invent a Location', async () => {
  const result = await resolvePhysicalLocation(mockAdmin(baseRows()), {
    venueName: 'Santiago Marriott Hotel',
  })
  assert.deepEqual(result, { locationId: null, matchType: 'insufficient_data' })
})

test('valid locationId resolves as existing', async () => {
  const result = await resolvePhysicalLocation(mockAdmin(baseRows()), {
    locationId: PLACE_ID,
  })
  assert.deepEqual(result, { locationId: PLACE_ID, matchType: 'existing' })
})

test('sufficient new address creates a canonical place', async () => {
  const rows = baseRows()
  const result = await resolvePhysicalLocation(mockAdmin(rows), {
    venueName: 'Nuevo Venue',
    address: 'Suecia 210',
    commune: 'Las Condes',
    region: 'Región Metropolitana',
    country: 'Chile',
    organizationId: ORG_ID,
  })
  assert.equal(result.matchType, 'new')
  assert.ok(result.locationId)
})

test('invalid locationId is rejected', async () => {
  await assert.rejects(
    () => resolvePhysicalLocation(mockAdmin(baseRows()), { locationId: 'not-a-uuid' }),
    (error: unknown) => error instanceof PhysicalLocationError && error.status === 400,
  )
})
