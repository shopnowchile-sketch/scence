import test from 'node:test'
import assert from 'node:assert/strict'
import { validateEcommerceLinks, readEcommerceLinks } from '../src/lib/brand-ecommerce.ts'

test('acepta http(s) y normaliza', () => {
  const r = validateEcommerceLinks([{ name: ' Tienda ', url: 'https://tienda.cl' }])
  assert.ok(r.ok && r.value[0].name === 'Tienda' && r.value[0].url === 'https://tienda.cl/')
})
test('rechaza esquemas peligrosos, vacíos y exceso', () => {
  assert.equal(validateEcommerceLinks([{ name: 'x', url: 'javascript:alert(1)' }]).ok, false)
  assert.equal(validateEcommerceLinks([{ name: '', url: 'https://a.cl' }]).ok, false)
  assert.equal(validateEcommerceLinks(Array.from({ length: 11 }, () => ({ name: 'a', url: 'https://a.cl' }))).ok, false)
  assert.equal(validateEcommerceLinks('x').ok, false)
})
test('readEcommerceLinks tolera metadata ausente o corrupta', () => {
  assert.deepEqual(readEcommerceLinks(null), [])
  assert.deepEqual(readEcommerceLinks({ ecommerce_links: [{ name: 'a', url: 'nope' }] }), [])
})
