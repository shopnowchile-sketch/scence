// Flujo Pro de influencers: robustez ante páginas de PayPal que se cuelgan o tardan en activar.
// Pruebas estáticas sobre el código (no ejecutan PayPal ni la interfaz).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const checkout = readFileSync(new URL('../src/app/api/influencer/paypal/checkout/route.ts', import.meta.url), 'utf8')
const ui = readFileSync(new URL('../src/app/(influencer)/inf-plan/InfluencerPlanSettings.tsx', import.meta.url), 'utf8')

test('checkout Pro: el PayPal-Request-Id es estable por influencer y ventana (sin una suscripción nueva por clic)', () => {
  assert.doesNotMatch(checkout, /'PayPal-Request-Id':[^\n]*Date\.now\(\)\s*\}/, 'no puede depender solo de Date.now()')
  assert.match(checkout, /PayPal-Request-Id[^\n]*influencer\.id[^\n]*Math\.floor\(Date\.now\(\) \/ \(15 \* 60_000\)\)/)
})

test('pantalla de Plan: reintenta la confirmación cuando PayPal aún no activa y avisa en navegadores internos', () => {
  assert.match(ui, /attempt < 5/)
  assert.match(ui, /response\.status !== 409/)
  assert.match(ui, /FBAN\|FBAV/)
  assert.match(ui, /checkout'\) === 'cancelled'/)
})
