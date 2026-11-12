// Regresiones de la ficha de marcas (2026-11-12). Guardias estáticas sobre el código fuente (sin red ni base).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const src = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('brands.notes es exclusivo de Admin: las rutas de influencer no lo leen, escriben ni devuelven', () => {
  for (const path of ['src/app/api/influencer/owned-brands/route.ts', 'src/app/api/influencer/owned-brands/[id]/route.ts']) {
    const code = src(path)
    assert.doesNotMatch(code, /formText\(form, 'notes'\)/, `${path} escribe notes`)
    assert.doesNotMatch(code, /instagram, notes,/, `${path} selecciona notes`)
    assert.match(code, /notes: _adminNotes/, `${path} debe quitar notes de la respuesta`)
  }
  const page = src('src/app/(influencer)/inf-brands/page.tsx')
  assert.doesNotMatch(page, /notes/, 'la pantalla de influencer no debe mostrar ni editar notes')
})

test('brands.notes: el registro desde el portal de marca no lo escribe ni lo devuelve', () => {
  const code = src('src/app/api/brand/brands/route.ts')
  assert.doesNotMatch(code, /notes: body\.notes/)
  assert.match(code, /notes: _adminNotes/)
})

test('ningún pago ni webhook de PayPal reactiva una marca suspendida', () => {
  const webhook = src('src/app/api/paypal/webhook/route.ts')
  assert.doesNotMatch(webhook, /from\('brands'\)/, 'el webhook no debe escribir brands')
  const complete = src('src/app/api/paypal/complete/route.ts')
  assert.match(complete, /\.eq\('status', 'pending_approval'\)/, 'pagar solo aprueba marcas pendientes')
})

test('una marca suspendida ve el aviso de suspensión y no se redirige a Planes', () => {
  const layout = src('src/app/(brand)/layout.tsx')
  assert.doesNotMatch(layout, /brandStatus === 'suspended' && !isPlanPage\) router\.replace/)
  assert.match(layout, /Esta marca se encuentra suspendida\. Contacta a soporte para solicitar una revisión\./)
  assert.doesNotMatch(layout, /período de acceso gratuito/)
})

test('el formulario de Direcciones reutiliza el buscador de Google Maps y invalida coordenadas al editar a mano', () => {
  const form = src('src/components/brand/BrandAddressForm.tsx')
  assert.match(form, /import \{ GooglePlacesAddress \}/)
  assert.match(form, /address_place_id: address\.placeId, address_lat: address\.lat, address_lng: address\.lng/)
  assert.match(form, /address_place_id: '', address_lat: null, address_lng: null/)
})
