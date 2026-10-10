import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizeWhatsappPhone } from '../src/lib/brands/contact.ts'
import { normalizeInstagramHandle } from '../src/lib/brands/instagram.ts'

test('WhatsApp: acepta formato internacional y lo normaliza', () => {
  assert.equal(normalizeWhatsappPhone('+56 9 1234 5678'), '+56912345678')
  assert.equal(normalizeWhatsappPhone('0056 9 1234-5678'), '+56912345678')
  assert.equal(normalizeWhatsappPhone('+1 (818) 555-0100'), '+18185550100')
})

test('WhatsApp: rechaza vacío, sin código de país, corto o con letras', () => {
  for (const bad of ['', '   ', null, undefined, '912345678', '+56', '+0123456789', '+56 9 abcd 5678', '+5691234567890123']) {
    assert.equal(normalizeWhatsappPhone(bad), null, String(bad))
  }
})

test('Instagram: normaliza @ y URL, rechaza vacío', () => {
  assert.equal(normalizeInstagramHandle('@MiMarca'), 'mimarca')
  assert.equal(normalizeInstagramHandle('https://instagram.com/mimarca/'), 'mimarca')
  assert.equal(normalizeInstagramHandle(''), null)
})

test('register-brand exige Instagram y WhatsApp en backend y los persiste', () => {
  const route = readFileSync('src/app/api/auth/register-brand/route.ts', 'utf8')
  assert.match(route, /normalizeInstagramHandle\(body\.instagram\)/)
  assert.match(route, /normalizeWhatsappPhone\(body\.whatsapp\)/)
  assert.match(route, /status: 422/)
  assert.match(route, /brand_instagram: instagram/)
  assert.match(route, /brand_whatsapp: whatsapp/)
  const ensure = readFileSync('src/lib/supabase/ensureOrg.ts', 'utf8')
  assert.match(ensure, /instagram:\s+brandInstagram/)
  assert.match(ensure, /contact_phone:\s+brandWhatsapp/)
})

test('perfil de marca no permite vaciar WhatsApp y onboarding lo exige', () => {
  const me = readFileSync('src/app/api/brand/me/route.ts', 'utf8')
  assert.match(me, /normalizeWhatsappPhone\(finalWhatsapp\)/)
  assert.match(me, /contact_phone:\s+normalizedWhatsapp/)
  const onboarding = readFileSync('src/app/api/brand/onboarding/route.ts', 'utf8')
  assert.match(onboarding, /brand\?\.contact_phone\?\.trim\(\)/)
})
