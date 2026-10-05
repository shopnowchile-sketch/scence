import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  computeBrandPlanAccess,
  isInfluencerSubscription,
  normalizePlanOverride,
  type BrandSubscriptionRow,
} from '../src/lib/plan-limits.ts'

const row = (tier: string, metadata: unknown = { account_type: 'brand' }): BrandSubscriptionRow => ({
  id: 's1', organization_id: 'o1', status: 'active', created_at: '2026-10-01', current_period_end: null,
  paypal_subscription_id: 'I-X', metadata, plan: { tier },
})

test('override administrativo manda sobre todo y da acceso', () => {
  const access = computeBrandPlanAccess('pro', null)
  assert.equal(access.plan, 'pro')
  assert.equal(access.source, 'override')
  assert.equal(access.hasActiveAccess, true)
})

test('override basic sigue siendo acceso administrativo aunque no haya pago', () => {
  const access = computeBrandPlanAccess('basic', null)
  assert.equal(access.plan, 'basic')
  assert.equal(access.hasActiveAccess, true)
})

test('suscripción de marca activa define el plan; starter se lee como basic', () => {
  assert.equal(computeBrandPlanAccess(null, row('growth')).plan, 'growth')
  assert.equal(computeBrandPlanAccess(null, row('starter')).plan, 'basic')
  assert.equal(computeBrandPlanAccess(null, row('pro')).hasActiveAccess, true)
})

test('sin override ni suscripción: basic y sin acceso', () => {
  const access = computeBrandPlanAccess(null, null)
  assert.equal(access.plan, 'basic')
  assert.equal(access.hasActiveAccess, false)
})

test('valores de override inválidos no cuentan', () => {
  assert.equal(normalizePlanOverride('free'), null)
  assert.equal(normalizePlanOverride(''), null)
  assert.equal(normalizePlanOverride('growth'), 'growth')
})

test('una suscripción de influencer se reconoce como tal', () => {
  assert.equal(isInfluencerSubscription({ account_type: 'influencer', influencer_id: 'x' }), true)
  assert.equal(isInfluencerSubscription({ account_type: 'brand' }), false)
  assert.equal(isInfluencerSubscription({}), false)
  assert.equal(isInfluencerSubscription(null), false)
})

test('la lectura de suscripciones de marca descarta las de influencer (fuente única)', () => {
  const source = readFileSync(new URL('../src/lib/plan-limits.ts', import.meta.url), 'utf8')
  assert.match(source, /if \(isInfluencerSubscription\(row\.metadata\)\) continue/)
  // Sin fallback a organizations.subscription_plan.
  assert.doesNotMatch(source, /from\('organizations'\)/)
})

test('ningún flujo de pago de marca escribe el override', () => {
  for (const file of ['../src/app/api/paypal/complete/route.ts', '../src/app/api/paypal/webhook/route.ts']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /subscription_plan_override/)
    assert.doesNotMatch(source, /subscription_plan:/)
  }
})

test('el PATCH de campaña de marca resuelve el plan por la marca, no por la org de la campaña', () => {
  const source = readFileSync(new URL('../src/app/api/brand/campaigns/[id]/route.ts', import.meta.url), 'utf8')
  assert.match(source, /resolveBrandPlan\(admin, brand\.id\)/)
  assert.doesNotMatch(source, /campaignBase\.organization_id, brand\.id/)
})
