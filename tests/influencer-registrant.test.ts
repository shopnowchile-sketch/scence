import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolveRegisteredBy } from '../src/lib/influencer-registrant.ts'

test('sin organización → plataforma', () => {
  assert.equal(resolveRegisteredBy({ organizationId: null, brandsInOrg: [], associatedBrands: [] }), 'SCENCE')
})
test('organización sin marca → plataforma (no se adivina por antigüedad)', () => {
  assert.equal(resolveRegisteredBy({ organizationId: 'o1', brandsInOrg: [], associatedBrands: [{ name: 'X' }] }), 'SCENCE')
})
test('una marca en la organización → esa marca', () => {
  assert.equal(resolveRegisteredBy({ organizationId: 'o1', brandsInOrg: [{ name: 'Marca A' }], associatedBrands: [] }), 'Marca A')
})
test('organización compartida → marca vinculada más antigua o «Marca»', () => {
  const brandsInOrg = [{ name: 'A' }, { name: 'B' }]
  assert.equal(resolveRegisteredBy({ organizationId: 'o1', brandsInOrg, associatedBrands: [{ name: 'B' }] }), 'B')
  assert.equal(resolveRegisteredBy({ organizationId: 'o1', brandsInOrg, associatedBrands: [] }), 'Marca')
})
test('ningún código asigna ni rotula por la organización más antigua', () => {
  for (const f of ['src/app/api/influencers/route.ts', 'src/lib/supabase/ensureOrg.ts']) {
    const src = readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    assert.doesNotMatch(src, /oldestOrg|scenceOrgId/, f)
    assert.doesNotMatch(src, /from\('organizations'\)[\s\S]{0,200}order\('created_at',\s*\{\s*ascending:\s*true/, f)
  }
})
