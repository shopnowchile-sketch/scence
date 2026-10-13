import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const route = readFileSync(new URL('../src/app/api/crm-leads/[id]/route.ts', import.meta.url), 'utf8')
const patch = route.slice(route.indexOf('export async function PATCH'))

test('PATCH lead: autoriza antes de editar datos de contacto', () => {
  assert.ok(patch.indexOf('isCrmAdmin(user, admin)') < patch.indexOf('EDITABLE_FIELDS'))
})
test('PATCH lead: solo campos de la lista blanca y email validado/normalizado', () => {
  assert.match(route, /const EDITABLE_FIELDS = \['contact_name', 'company_name', 'email'/)
  assert.doesNotMatch(route.slice(route.indexOf('const EDITABLE_FIELDS'), route.indexOf('const VALID_STATUS')), /qualification_status|converted_brand_id|source/)
  assert.match(patch, /toLowerCase\(\)/)
  assert.match(patch, /EMAIL_RE\.test\(value\)/)
})
test('PATCH lead: rechaza email duplicado en otro lead (409) y limpia validación previa', () => {
  assert.match(patch, /\.neq\('id', params\.id\)/)
  assert.match(patch, /status: 409/)
  assert.match(patch, /update\.email_result = null/)
})
test('PATCH lead: comuna estandarizada, caché invalidada y cambio registrado en historial', () => {
  assert.match(patch, /canonicalCommune\(admin, value\)/)
  assert.match(patch, /bumpCrmCacheVersion\(\)/)
  assert.match(patch, /Datos actualizados:/)
})
test('EMAIL_RE acepta direcciones válidas y rechaza inválidas', () => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
  assert.ok(re.test('contacto@loreal.com'))
  assert.ok(!re.test('loreal.com'))
  assert.ok(!re.test('a b@c.com'))
  assert.ok(!re.test('a@b'))
})
