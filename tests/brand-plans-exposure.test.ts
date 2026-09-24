// Commit 2 — guardado de planes y exposición por audiencia.
//   node --test tests/brand-plans-exposure.test.ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  buildOpportunityConfig,
  normalizePlans,
  toBrandOpportunityDTO,
  withoutCollaborationOpportunity,
  type BrandPlan,
} from '../src/lib/brand-plans.ts'
import { GOLDEN_PLANS_INPUT } from './fixtures/golden-launch-experience.ts'

const NOW = new Date('2026-09-24T12:00:00Z')
let seq = 0
const opts = () => ({ now: NOW, newId: () => `plan-${++seq}` })

function metadataWithPlans(overrides: Record<string, unknown> = {}) {
  seq = 0
  const r = normalizePlans(GOLDEN_PLANS_INPUT, [], opts())
  assert.ok(r.ok)
  return {
    address: 'Dirección privada 123',
    event_date: '2026-11-14',
    collaboration_opportunity: { enabled: true, application_deadline: null, schema_version: 2, plans: r.plans, ...overrides },
  }
}
const plansOf = (meta: ReturnType<typeof metadataWithPlans>) => meta.collaboration_opportunity.plans as BrandPlan[]

describe('buildOpportunityConfig (PUT)', () => {
  test('crear 3 planes desde una campaña sin oportunidad', () => {
    seq = 0
    const r = buildOpportunityConfig({}, { enabled: true, plans: GOLDEN_PLANS_INPUT }, opts())
    assert.ok(r.ok)
    assert.equal(r.config.schema_version, 2)
    assert.deepEqual(r.config.plans!.map(p => p.name), ['Bronze', 'Premium', 'Superior'])
  })
  test('un body sin `plans` conserva los planes guardados (cliente antiguo no borra)', () => {
    const meta = metadataWithPlans()
    const r = buildOpportunityConfig(meta, { enabled: false, benefits: 'x' }, opts())
    assert.ok(r.ok)
    assert.deepEqual(r.config.plans, plansOf(meta))
    assert.equal(r.config.enabled, false)
  })
  test('editar precio y desactivar conserva ids', () => {
    const meta = metadataWithPlans()
    const edited = plansOf(meta).map(p => p.name === 'Superior' ? { ...p, price: 800000 } : p.name === 'Bronze' ? { ...p, active: false } : p)
    const r = buildOpportunityConfig(meta, { enabled: true, plans: edited }, opts())
    assert.ok(r.ok)
    assert.deepEqual(r.config.plans!.map(p => p.id), plansOf(meta).map(p => p.id))
    assert.equal(r.config.plans!.find(p => p.name === 'Superior')!.price, 800000)
  })
  test('ids inventados por el cliente se reemplazan por ids de servidor', () => {
    const r = buildOpportunityConfig({}, { plans: [{ id: 'hackeado', name: 'Starter', price: 1000 }] }, { now: NOW, newId: () => 'server-id' })
    assert.ok(r.ok)
    assert.equal(r.config.plans![0].id, 'server-id')
  })
  test('borrar un plan guardado → 422 con errores', () => {
    const meta = metadataWithPlans()
    const r = buildOpportunityConfig(meta, { plans: plansOf(meta).slice(1) }, opts())
    assert.equal(r.ok, false)
  })
  test('lista vacía sobre campaña sin planes → modo legacy sin clave plans', () => {
    const r = buildOpportunityConfig({}, { enabled: true, benefits: 'Stand', participation_value: '350000', seats: '4', plans: [] }, opts())
    assert.ok(r.ok)
    assert.equal('plans' in r.config, false)
    assert.equal(r.config.participation_value, 350000)
    assert.equal(r.config.seats, 4)
  })
})

describe('toBrandOpportunityDTO (marca no dueña)', () => {
  test('solo planes activos, sin notas internas ni metadata ajena', () => {
    const meta = metadataWithPlans()
    plansOf(meta)[1].active = false
    const dto = toBrandOpportunityDTO(meta)
    assert.ok(dto && dto.mode === 'plans')
    assert.deepEqual(dto.plans.map(p => p.name), ['Bronze', 'Superior'])
    const json = JSON.stringify(dto)
    assert.ok(!json.includes('internal_notes'))
    assert.ok(!json.includes('negociado'))
    assert.ok(!json.includes('Dirección privada'))
    assert.ok(!json.includes('created_at'))
  })
  test('oportunidad desactivada → null', () => {
    assert.equal(toBrandOpportunityDTO(metadataWithPlans({ enabled: false })), null)
  })
  test('sin planes activos → null', () => {
    const meta = metadataWithPlans()
    plansOf(meta).forEach(p => { p.active = false })
    assert.equal(toBrandOpportunityDTO(meta), null)
  })
  test('legacy se mantiene visible como antes', () => {
    const dto = toBrandOpportunityDTO({ collaboration_opportunity: { enabled: true, benefits: 'Stand', participation_value: 100000, currency: 'CLP', seats: 3 } })
    assert.deepEqual(dto, { mode: 'legacy', application_deadline: null, benefits: 'Stand', participation_value: 100000, currency: 'CLP' })
  })
})

describe('withoutCollaborationOpportunity (influencers)', () => {
  test('retira solo la oferta comercial y no muta el original', () => {
    const meta = metadataWithPlans()
    const clean = withoutCollaborationOpportunity(meta) as Record<string, unknown>
    assert.equal('collaboration_opportunity' in clean, false)
    assert.equal(clean.address, 'Dirección privada 123')
    assert.equal(clean.event_date, '2026-11-14')
    assert.ok('collaboration_opportunity' in meta)
  })
  test('valores no objeto pasan intactos', () => {
    assert.equal(withoutCollaborationOpportunity(null), null)
    assert.equal(withoutCollaborationOpportunity(undefined), undefined)
  })
})

describe('rutas y UI (verificación de código)', () => {
  const src = (rel: string) => readFileSync(fileURLToPath(new URL(`../src/${rel}`, import.meta.url)), 'utf8')
  test('GET de oportunidades para marcas no reenvía metadata ni el config crudo', () => {
    const route = src('app/api/brand/collaboration-opportunities/route.ts')
    assert.ok(route.includes('toBrandOpportunityDTO(c.metadata)'))
    assert.ok(!/\{\s*\.\.\.c\s*,/.test(route))
  })
  test('detalle de campaña para influencers retira collaboration_opportunity', () => {
    assert.ok(src('app/api/influencer/campaigns/[id]/route.ts').includes('payload.metadata = withoutCollaborationOpportunity(campaign.metadata)'))
  })
  test('PUT de oportunidad valida con buildOpportunityConfig y conserva la autorización existente', () => {
    const route = src('app/api/campaigns/[id]/collaboration-opportunity/route.ts')
    assert.ok(route.includes('buildOpportunityConfig(current, body)'))
    assert.ok(route.includes("hasBrandPermission(access, 'campaign.manage')"))
    assert.ok(route.includes('getUserRole(user.id, org, admin)).isAdmin'))
  })
  test('D6 = NO: el acceso a assets no cambió (sin acceso privado por propuesta)', () => {
    const access = src('lib/campaign-asset-access.ts')
    assert.ok(!access.includes('campaign_brand_applications'))
  })
  test('botón de propuesta comercial y editor de planes solo fuera del portal de marca', () => {
    const detail = src('app/(dashboard)/admin-campaigns/[id]/CampaignDetail.tsx')
    assert.ok(/\{!isBrandPortal && \(\s*<button[\s\S]{0,200}sponsorBriefUploadInputRef/.test(detail))
    assert.ok(/\{tab === 'contracts' && !isBrandPortal && \(\s*<CollaborationOpportunitySettings/.test(detail))
  })
  test('ningún archivo nuevo o tocado define nombres de plan', () => {
    for (const file of ['components/campaigns/CollaborationOpportunitySettings.tsx', 'app/(brand)/brand-opportunities/page.tsx', 'app/api/campaigns/[id]/collaboration-opportunity/route.ts', 'app/api/brand/collaboration-opportunities/route.ts']) {
      assert.ok(!/\b(Bronze|Premium|Superior|Gold|Platinum)\b/.test(src(file)), file)
    }
  })
})
