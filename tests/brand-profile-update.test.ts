import test from 'node:test'
import assert from 'node:assert/strict'
import { buildBrandProfileUpdate, mergeLegalState } from '../src/lib/brand-profile-update.ts'

test('un PATCH solo de dirección no toca contacto, web, RUT ni coordenadas', () => {
  const update = buildBrandProfileUpdate({ address_street: 'Av. Providencia', address_city: 'Providencia' })
  assert.deepEqual(Object.keys(update).sort(), ['address_city', 'address_street'])
})

test('un campo enviado vacío se guarda como null; uno ausente no se escribe', () => {
  const update = buildBrandProfileUpdate({ website: '', contact_phone: '+56912345678' })
  assert.equal(update.website, null)
  assert.equal(update.contact_phone, '+56912345678')
  assert.equal('industry' in update, false)
})

test('lat/lng enviadas se guardan; el nombre vacío se ignora', () => {
  const update = buildBrandProfileUpdate({ name: '  ', address_lat: -33.4, address_lng: -70.6, address_place_id: 'abc' })
  assert.equal('name' in update, false)
  assert.equal(update.address_lat, -33.4)
  assert.equal(update.address_place_id, 'abc')
})

test('la validación legal usa el estado final: lo guardado + lo enviado', () => {
  const merged = mergeLegalState({ rut: '76.123.456-7', address_street: 'Calle 1' }, { address_street: 'Calle 2' })
  assert.equal(merged.rut, '76.123.456-7')
  assert.equal(merged.address_street, 'Calle 2')
})

import { readFileSync } from 'node:fs'

test('suspender exige motivo, registra historial y no toca el plan ni las suscripciones', () => {
  const route = readFileSync(new URL('../src/app/api/brands/[id]/route.ts', import.meta.url), 'utf8')
  assert.match(route, /suspension_reason/)
  assert.match(route, /brand\.status_changed/)
  assert.doesNotMatch(route, /rest\.status === 'suspended'\s*\)\s*\{\s*rest\.subscription_plan_override\s*=\s*null/)
  assert.doesNotMatch(route, /subscription_plan_override\s*=\s*null/)
})

test('los puntos de suspensión de la interfaz piden motivo y ya no prometen quitar el plan', () => {
  const table = readFileSync(new URL('../src/components/brands/BrandsTable.tsx', import.meta.url), 'utf8')
  const page = readFileSync(new URL('../src/app/(dashboard)/admin-brands/[id]/page.tsx', import.meta.url), 'utf8')
  assert.match(table, /suspension_reason/)
  assert.doesNotMatch(table, /quita el plan manual/)
  assert.match(page, /suspension_reason/)
  assert.doesNotMatch(page, /subscription_plan_override: status === 'suspended' \? null/)
})
