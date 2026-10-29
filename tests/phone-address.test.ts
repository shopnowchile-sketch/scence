// Teléfono internacional (E.164), dirección estructurada y compatibilidad con perfiles existentes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'
register('./support/ts-resolve.mjs', import.meta.url)

const phone = await import('../src/lib/phone.ts')
const addr = await import('../src/lib/address-parts.ts')
const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

test('E.164 por país: Chile, Argentina, México, España', () => {
  assert.deepEqual(phone.toE164('9 1234 5678', 'CL'), { ok: true, e164: '+56912345678', iso: 'CL', national: '912345678' })
  assert.equal((phone.toE164('11 5555 1234', 'AR') as { e164: string }).e164, '+541155551234')
  assert.equal((phone.toE164('55 1234 5678', 'MX') as { e164: string }).e164, '+525512345678')
  assert.equal((phone.toE164('612 345 678', 'ES') as { e164: string }).e164, '+34612345678')
})

test('validación por país con mensajes en español', () => {
  const short = phone.toE164('1234', 'CL')
  assert.equal(short.ok, false)
  assert.match((short as { error: string }).error, /Chile .* 9 dígitos/)
  assert.equal(phone.toE164('', 'CL').ok, false)
  assert.equal((phone.toE164('1'.repeat(30), 'CL') as { e164: string }).e164, '+56111111111') // se recorta al máximo del país
})

test('el prefijo repetido no se duplica y el 0 de troncal se ignora', () => {
  assert.equal((phone.toE164('+56 9 1234 5678', 'CL') as { e164: string }).e164, '+56912345678')
  assert.equal((phone.toE164('09 1234 5678', 'CL') as { e164: string }).e164, '+56912345678')
})

test('formato automático mientras se escribe', () => {
  assert.equal(phone.formatNational('912345678', 'CL'), '9 1234 5678')
  assert.equal(phone.formatNational('5512345678', 'MX'), '55 1234 5678')
})

test('catálogo de países: ISO único, prefijos y banderas', () => {
  const isos = phone.PHONE_COUNTRIES.map((c: { iso: string }) => c.iso)
  assert.equal(new Set(isos).size, isos.length)
  assert.equal(phone.phoneCountryFlag('CL'), '🇨🇱')
  assert.ok(phone.PHONE_COUNTRIES.every((c: { min: number; max: number }) => c.min >= 7 && c.max >= c.min))
})

test('compatibilidad: teléfonos guardados con formato antiguo se separan sin perder datos', () => {
  assert.deepEqual(phone.splitStoredPhone('+56 912345678'), { iso: 'CL', national: '912345678' })
  assert.deepEqual(phone.splitStoredPhone('+56912345678'), { iso: 'CL', national: '912345678' })
  assert.equal(phone.splitStoredPhone('912345678'), null)
  assert.equal(phone.splitStoredPhone(null), null)
})

test('API: solo acepta E.164 válido', () => {
  assert.equal(phone.parseE164('+56912345678').ok, true)
  assert.equal(phone.parseE164('912345678').ok, false)
  assert.equal(phone.parseE164('+56123').ok, false)
  assert.equal(phone.parseE164('+99912345678').ok, false)
})

test('dirección: compone texto, conserva la dirección antigua y sanea entradas', () => {
  assert.equal(addr.composeAddress({ street: 'Av. Providencia 1234', unit: 'Depto 5', postal_code: '7500000' }), 'Av. Providencia 1234, Depto 5, CP 7500000')
  assert.equal(addr.composeAddress({ street: 'Calle 1', unit: '', postal_code: '' }), 'Calle 1')
  assert.deepEqual(addr.partsFromProfile('Av. Vieja 99, Ñuñoa', null), { street: 'Av. Vieja 99, Ñuñoa', unit: '', postal_code: '' })
  assert.equal(addr.partsFromProfile('x', { street: 'A', unit: 'B', postal_code: '123' }).street, 'A')
  assert.equal(addr.sanitizeAddressParts('texto'), null)
  assert.equal(addr.sanitizeAddressParts({ street: ' a   b ', postal_code: '<75>' })?.postal_code, '75')
})

test('ubicación: la geografía vive solo en location_id (sin campos paralelos)', () => {
  const route = read('src/app/api/influencer/me/route.ts')
  assert.doesNotMatch(route, /allowed = \[[^\]]*(country|commune|city|region)/)
  const form = read('src/components/influencers/StructuredAddressFields.tsx')
  assert.match(form, /onLocationChange\(nextChain\[nextChain\.length - 1\]/)
  assert.doesNotMatch(form, /\.from\('influencers'\)|commune_name|city_name/)
})

test('API de perfil: teléfono validado y dirección sin sobrescribir metadata ajeno', () => {
  const route = read('src/app/api/influencer/me/route.ts')
  assert.match(route, /parseE164\(incoming\)/)
  assert.match(route, /\{ \.\.\.current, address_parts: addressParts \}/)
  assert.match(route, /incoming !== String\(influencer\.phone/)
})

test('selectores dependientes usan el endpoint de locations (parent / ancestors)', () => {
  const route = read('src/app/api/influencer/locations/route.ts')
  assert.match(route, /params\.get\('parent'\)/)
  assert.match(route, /params\.get\('ancestors'\)/)
})

test('países: migración con el catálogo completo, idempotente y sin tocar regiones', () => {
  const sql = read('supabase/migrations/20261029160000_locations_all_countries.sql')
  const names = [...sql.matchAll(/\('([^']+)'\)/g)].map(m => m[1])
  assert.ok(names.length >= 190 && new Set(names).size === names.length)
  for (const n of ['Chile', 'Argentina', 'Japón', 'Zimbabue', 'Estados Unidos']) assert.ok(names.includes(n), n)
  assert.match(sql, /WHERE NOT EXISTS/)
  assert.doesNotMatch(sql, /DELETE|UPDATE|level\s*=\s*'region'\s*,/)
})

test('selector de ubicación con búsqueda al escribir y perfil mostrando comuna y región', () => {
  const form = read('src/components/influencers/StructuredAddressFields.tsx')
  assert.match(form, /role="combobox"/)
  assert.match(form, /normalize\('NFD'\)/)
  const page = read('src/app/(influencer)/inf-profile/page.tsx')
  assert.match(page, /\[profile\.commune \?\? profile\.city, profile\.region, profile\.country\]/)
  assert.match(page, /<span>\{profile\.address\}<\/span>/)
})

test('catálogo de ubicaciones: páginas bajo el tope de filas del proyecto y con orden estable', () => {
  const route = read('src/app/api/influencer/locations/route.ts')
  assert.match(route, /\.order\('id', \{ ascending: true \}\)/)
  assert.match(route, /pageSize: 250/)
  assert.match(read('src/lib/influencer-location.ts'), /pageSize: 250/)
})

test('perfil: fecha vacía se guarda como null y los errores de base no se muestran crudos', () => {
  const route = read('src/app/api/influencer/me/route.ts')
  assert.match(route, /if \(!raw\) profileUpdate\.birth_date = null/)
  assert.match(route, /La fecha de nacimiento no es válida/)
  assert.doesNotMatch(route, /error: upErr\.message/)
  assert.match(route, /No se pudo guardar tu perfil/)
})
