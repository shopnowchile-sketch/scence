// El roster de una marca: trabajadas (aceptadas), postulantes (pendientes) y las que su marca agregó o SCENCE le asignó.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const route = readFileSync(new URL('../src/app/api/brand/influencers/route.ts', import.meta.url), 'utf8')

test('el listado incluye aceptadas, pendientes y brand_influencers de SU marca', () => {
  assert.match(route, /\.in\('application_status', \['accepted', 'pending'\]\)/)
  assert.match(route, /from\('brand_influencers'\)\s*\.select\('influencer_id'\)\s*\.eq\('brand_id', brand\.id\)/)
})

test('solo campañas propias o creadas por la marca, y nunca el catálogo global', () => {
  assert.match(route, /brand_id\.eq\.\$\{brand\.id\},created_by_brand_id\.eq\.\$\{brand\.id\}/)
  assert.match(route, /La marca nunca ve el catálogo global/)
})

test('«Agregar influencer» se conserva (POST de la marca)', () => {
  assert.match(route, /export async function POST/)
})
