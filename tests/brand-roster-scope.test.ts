// El roster de una marca: trabajadas (aceptadas), postulantes (pendientes) y las que su marca agregó o SCENCE le asignó.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const route = readFileSync(new URL('../src/app/api/brand/influencers/route.ts', import.meta.url), 'utf8')

test('el listado usa el alcance único por relación (cualquier estado, colaboradas y roster)', () => {
  assert.match(route, /getBrandInfluencerScope\(admin, brand\.id\)/)
  assert.doesNotMatch(route, /application_status', \['accepted', 'pending'\]/)
})

test('nunca el catálogo global', () => {
  assert.match(route, /La marca nunca ve el catálogo global/)
})

test('el helper cubre campañas propias/creadas, colaboradas (campaign_brands) y brand_influencers, sin filtrar estado', () => {
  const helper = readFileSync(new URL('../src/lib/brand-influencer-scope.ts', import.meta.url), 'utf8')
  assert.match(helper, /brand_id\.eq\.\$\{brandId\},created_by_brand_id\.eq\.\$\{brandId\}/)
  assert.match(helper, /from\('campaign_brands'\)/)
  assert.match(helper, /from\('brand_influencers'\)/)
  assert.doesNotMatch(helper, /application_status/)
  assert.doesNotMatch(helper, /from\('brand_collaborators'\)/)
})

test('ranking, detalle, comunas, invitación y alta a campaña usan el mismo alcance', () => {
  for (const file of ['brand/influencers/ranking/route.ts', 'brand/influencers/[id]/route.ts', 'brand/influencers/communes/route.ts', 'brand/campaigns/[id]/invite/route.ts', 'campaigns/[id]/influencers/route.ts']) {
    assert.match(readFileSync(new URL(`../src/app/api/${file}`, import.meta.url), 'utf8'), /getBrandInfluencerScope/, file)
  }
})

test('«Agregar influencer» se conserva (POST de la marca)', () => {
  assert.match(route, /export async function POST/)
})
