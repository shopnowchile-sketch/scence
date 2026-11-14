// Precios SCORE (2026-11-14): planes reutilizados, Pro fuera de venta, campañas abiertas en Basic,
// tope de influencers al invitar y al aprobar, y modalidad gestión/entrenamiento solo Admin.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'
register('./support/ts-resolve.mjs', import.meta.url)
const {
  PLAN_LIMITS, BRAND_PLAN_USD_PRICING, BRAND_PLANS_FOR_SALE, BRAND_PLAN_INTRO_CLP,
  brandPlanUsdTerms, normalizeServiceMode, getPlanLimits,
} = await import('../src/lib/plan-limits.ts')
const { occupiesRosterSlot, rosterHasRoom } = await import('../src/lib/brand-roster-limit.ts')
const { AGENCY_PLAN_PRICE_USD, AGENCY_COMMITMENT_MONTHS } = await import('../src/lib/agency-brands.ts')

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('precios SCORE en CLP (IVA incluido): Pymes 70.000 → 150.000, Marcas 250.000', () => {
  assert.equal(PLAN_LIMITS.basic.price_monthly_clp, 150_000)
  assert.equal(BRAND_PLAN_INTRO_CLP.basic, 70_000)
  assert.equal(PLAN_LIMITS.growth.price_monthly_clp, 250_000)
  assert.equal(BRAND_PLAN_INTRO_CLP.growth, undefined)
})

test('agencia: US$69 por marca con 3 meses iniciales', () => {
  assert.equal(AGENCY_PLAN_PRICE_USD, 69)
  assert.equal(AGENCY_COMMITMENT_MONTHS, 3)
})

test('texto del cobro USD: precio de entrada de 1 mes en Pymes, precio fijo en Marcas', () => {
  assert.equal(BRAND_PLAN_USD_PRICING.basic.launchMonths, 1)
  assert.equal(brandPlanUsdTerms('basic'), 'US$75 el primer mes. Luego US$161/mes')
  assert.equal(brandPlanUsdTerms('growth'), 'US$269/mes')
})

test('Basic publica campañas abiertas y conserva 1 campaña activa y 5 influencers', () => {
  assert.equal(PLAN_LIMITS.basic.can_create_open_campaigns, true)
  assert.equal(PLAN_LIMITS.basic.max_active_campaigns, 1)
  assert.equal(PLAN_LIMITS.basic.max_roster_influencers, 5)
  // Una marca sin plan sigue resolviendo a los límites de Basic.
  assert.equal(getPlanLimits(null).max_roster_influencers, 5)
})

test('Pro antiguo: fuera de la venta en pantalla y en el servidor, sin perder sus límites', () => {
  assert.deepEqual([...BRAND_PLANS_FOR_SALE], ['basic', 'growth'])
  assert.equal(PLAN_LIMITS.pro.max_roster_influencers, 999)
  const checkout = read('src/app/api/paypal/checkout/route.ts')
  assert.match(checkout, /tier !== 'agency' && !BRAND_PLANS_FOR_SALE\.includes\(tier\)/)
  assert.match(read('src/components/plan/BrandPlanSettings.tsx'), /BRAND_PLANS_FOR_SALE\.includes\(plan\.tier\)/)
})

test('cupo del plan: cuentan aceptadas e invitaciones pendientes; una postulación pendiente no', () => {
  assert.equal(occupiesRosterSlot({ application_status: 'accepted', origin: 'application' }), true)
  assert.equal(occupiesRosterSlot({ application_status: 'pending', origin: 'invitation' }), true)
  assert.equal(occupiesRosterSlot({ application_status: 'pending', origin: 'application' }), false)
  assert.equal(occupiesRosterSlot({ application_status: 'rejected', origin: 'invitation' }), false)
})

test('cupo del plan: con 5 ocupadas no entra una sexta, pero quien ya ocupa cupo no lo consume de nuevo', () => {
  const rows = [
    ...['a', 'b', 'c', 'd'].map(id => ({ influencer_id: id, application_status: 'accepted', origin: 'application' })),
    { influencer_id: 'e', application_status: 'pending', origin: 'invitation' },
    { influencer_id: 'a', application_status: 'accepted', origin: 'invitation' }, // misma influencer en otra campaña
    ...['p1', 'p2', 'p3'].map(id => ({ influencer_id: id, application_status: 'pending', origin: 'application' })),
  ]
  assert.equal(rosterHasRoom(rows, 'p1', 5), false)
  assert.equal(rosterHasRoom(rows, 'a', 5), true)
  assert.equal(rosterHasRoom(rows.slice(0, 4), 'p1', 5), true)
})

test('el tope se verifica al invitar y al aprobar en el portal Marca, con la misma función', () => {
  for (const route of ['invite', 'applications']) {
    assert.match(read(`src/app/api/brand/campaigns/[id]/${route}/route.ts`), /checkBrandRosterLimit\(admin, brand\.id,/)
  }
})

test('cobro al enviar a aprobación: plan SCORE para pymes y marcas; Agency solo para marcas de agencia', () => {
  const brandRoute = read('src/app/api/brand/campaigns/[id]/route.ts')
  assert.match(brandRoute, /checkout: \(await isAgencyScopedBrand\(admin, gateBrandId\)\) \? 'agency' : 'plan'/)
  const checkout = read('src/app/api/paypal/checkout/route.ts')
  // El servidor rechaza la mensualidad de agencia para una marca que no es de agencia (POST y GET).
  assert.equal((checkout.match(/isAgencyScopedBrand\(/g) ?? []).length, 2)
  assert.match(checkout, /tier === 'agency' && !\(await isAgencyScopedBrand\(admin, access\.brandId\)\)/)
  // Sin doble cobro del mismo plan vigente.
  assert.match(checkout, /current\.source === 'subscription' && current\.plan === tier/)
  const gate = read('src/components/plan/AgencyCheckoutGate.tsx')
  assert.match(gate, /request\.checkout === 'plan'/)
  assert.match(gate, /\/brand-settings\/plan/)
})

test('límites solo para planes contratados: no bloquean a las marcas que ya operaban sin plan', () => {
  const applications = read('src/app/api/brand/campaigns/[id]/applications/route.ts')
  assert.match(applications, /contractedPlanOnly: true/)
  assert.match(read('src/lib/brand-roster-limit.ts'), /options\.contractedPlanOnly && access\.source !== 'subscription'\) return \{ ok: true \}/)
  // Campañas simultáneas: se controla al enviar a revisión, contando activas y en revisión, solo con plan contratado.
  const brandRoute = read('src/app/api/brand/campaigns/[id]/route.ts')
  assert.match(brandRoute, /planAccess\.source === 'subscription'/)
  assert.match(brandRoute, /\.in\('status', \['active', 'pending_approval'\]\)/)
})

test('solo Admin aprueba marcas: las de agencia no nacen aprobadas y una marca pendiente no publica campañas', () => {
  assert.doesNotMatch(read('src/app/api/brand/brands/route.ts'), /status: 'approved'/)
  const publication = read('src/app/api/campaigns/[id]/route.ts')
  assert.match(publication, /ownerBrand\?\.status !== 'approved'/)
  assert.match(publication, /code: BRAND_NOT_APPROVED/)
})

test('modalidad gestión/entrenamiento: valores cerrados y escritura solo por la ruta Admin', () => {
  assert.equal(normalizeServiceMode('managed'), 'managed')
  assert.equal(normalizeServiceMode('training'), 'training')
  assert.equal(normalizeServiceMode('otro'), null)
  const adminRoute = read('src/app/api/brands/[id]/route.ts')
  assert.match(adminRoute, /delete rest\.metadata/)            // el metadata del cliente se sigue descartando
  assert.match(adminRoute, /normalizeServiceMode\(raw\)/)
  const writers = ['src/app/api/brand/me/route.ts', 'src/lib/brand-profile-update.ts']
  for (const file of writers) assert.doesNotMatch(read(file), /service_mode/)
})

test('la migración solo cambia el precio de starter y growth; no toca pro, agency ni suscripciones', () => {
  const sql = read('supabase/migrations/20261114190000_subscription_plans_score_prices.sql')
    .split('\n').filter(line => !line.trim().startsWith('--')).join('\n')
  assert.match(sql, /price_monthly = 150000 where tier = 'starter'/)
  assert.match(sql, /price_monthly = 250000 where tier = 'growth'/)
  assert.doesNotMatch(sql, /'pro'|'agency'|subscriptions\b|is_active/)
  assert.ok(read('supabase/rollbacks/20261114190000_subscription_plans_score_prices_ROLLBACK.sql').includes("where tier = 'starter'"))
})
