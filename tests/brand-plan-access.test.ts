import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  brandSubscriptionGrantsAccess,
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
  assert.match(source, /if \(!brandSubscriptionGrantsAccess\(row, now\)\) continue/)
  assert.match(source, /if \(isInfluencerSubscription\(subscription\.metadata\)\) return false/)
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

// ── Acceso por estado de la suscripción de marca (cancelar = no renovar) ──
const NOW = Date.parse('2026-10-05T12:00:00Z')
const sub = (status: string, periodEnd: string | null, metadata: unknown = { account_type: 'brand' }): BrandSubscriptionRow => ({
  id: 's', organization_id: 'o', status, created_at: '2026-09-01', current_period_end: periodEnd,
  paypal_subscription_id: 'I-Y', metadata, plan: { tier: 'growth' },
})

test('active → acceso', () => {
  assert.equal(computeBrandPlanAccess(null, sub('active', '2026-09-01T00:00:00Z'), NOW).hasActiveAccess, true)
})

test('trialing → acceso', () => {
  assert.equal(computeBrandPlanAccess(null, sub('trialing', null), NOW).hasActiveAccess, true)
})

test('canceled con período vigente → acceso hasta current_period_end', () => {
  const access = computeBrandPlanAccess(null, sub('canceled', '2026-10-20T00:00:00Z'), NOW)
  assert.equal(access.hasActiveAccess, true)
  assert.equal(access.plan, 'growth')
})

test('canceled con período vencido → sin acceso', () => {
  const access = computeBrandPlanAccess(null, sub('canceled', '2026-10-01T00:00:00Z'), NOW)
  assert.equal(access.hasActiveAccess, false)
  assert.equal(access.plan, 'basic')
})

test('past_due (suspendida) → sin acceso aunque el período no haya vencido', () => {
  assert.equal(computeBrandPlanAccess(null, sub('past_due', '2026-10-20T00:00:00Z'), NOW).hasActiveAccess, false)
})

test('override → acceso aunque la suscripción haya vencido', () => {
  const access = computeBrandPlanAccess('pro', sub('canceled', '2026-10-01T00:00:00Z'), NOW)
  assert.equal(access.hasActiveAccess, true)
  assert.equal(access.plan, 'pro')
})

test('suscripción de influencer → nunca da acceso Brand, ni activa', () => {
  const influencer = { account_type: 'influencer', influencer_id: 'i1' }
  assert.equal(brandSubscriptionGrantsAccess(sub('active', null, influencer), NOW), false)
  assert.equal(computeBrandPlanAccess(null, sub('active', null, influencer), NOW).hasActiveAccess, false)
})

test('webhook de marca no retrocede el fin del período al cancelar', () => {
  const source = readFileSync(new URL('../src/app/api/paypal/webhook/route.ts', import.meta.url), 'utf8')
  const brandBranch = source.slice(source.indexOf('const ref = reference('))
  assert.match(brandBranch, /payPalPaidThrough\(subscription\)/)
  assert.match(brandBranch, /storedEnd > Date\.parse\(reportedEnd\)/)
})
