// node --test: normalización de teléfonos y link a WhatsApp.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizePhone, whatsappUrl } from '../src/lib/phone.ts'

test('chileno sin código → +56', () => {
  assert.equal(normalizePhone('912345678', 'Chile'), '+56 912345678')
  assert.equal(normalizePhone('9 1234 5678', 'Chile'), '+56 912345678')
})
test('no duplica +56', () => {
  assert.equal(normalizePhone('+56 9 1234 5678', 'Chile'), '+56 912345678')
  assert.equal(normalizePhone('56912345678', 'Chile'), '+56 912345678')
  assert.equal(normalizePhone('+56912345678', 'Chile'), '+56 912345678')
})
test('otro país usa su código, no Chile', () => {
  assert.equal(normalizePhone('11 2345 6789', 'Argentina'), '+54 1123456789')
  assert.equal(normalizePhone('5512345678', 'México'), '+52 5512345678')
  assert.equal(normalizePhone('+34 612345678', 'Chile'), '+34 612345678')
  assert.equal(normalizePhone('0034612345678', null), '+34 612345678')
})
test('sin país y sin + no se inventa; basura no se destruye', () => {
  assert.equal(normalizePhone('912345678', null), '912345678')
  assert.equal(normalizePhone('#ERROR!', 'Chile'), '#ERROR!')
  assert.equal(normalizePhone('12345678', 'Chile'), '12345678')
  assert.equal(normalizePhone('  ', 'Chile'), null)
  assert.equal(normalizePhone('‪+56 9 1234 5678‬', 'Chile'), '+56 912345678')
})
test('whatsapp: solo dígitos internacionales', () => {
  assert.equal(whatsappUrl('+56 9 1234 5678', 'Chile'), 'https://wa.me/56912345678')
  assert.equal(whatsappUrl('912345678', 'Chile'), 'https://wa.me/56912345678')
  assert.equal(whatsappUrl('912345678', null), null)
  assert.equal(whatsappUrl(null, 'Chile'), null)
})
