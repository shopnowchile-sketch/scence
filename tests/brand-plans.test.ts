// Planes comerciales para marcas (fuente única: src/lib/brand-plans.ts).
//   node --test tests/brand-plans.test.ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  ACTIVATION_DYNAMICS_CLAUSE,
  NO_GUARANTEED_PUBLICATIONS_CLAUSE,
  NON_EXCLUSIVITY_CLAUSE,
  appendPlanAnnex,
  collaborationClause,
  findForbiddenPromises,
  listPublicPlans,
  normalizeCollaborationAccount,
  normalizePlans,
  readOpportunity,
  renderPlanAnnex,
  splitPlanAmount,
  toPlanSnapshot,
  toPublicPlan,
  type BrandPlan,
} from '../src/lib/brand-plans.ts'
import { GOLDEN_BRAND, GOLDEN_CAMPAIGN, GOLDEN_PLANS_INPUT } from './fixtures/golden-launch-experience.ts'

const NOW = new Date('2026-09-24T12:00:00Z')
let seq = 0
const ids = () => `plan-${++seq}`

function goldenPlans(): BrandPlan[] {
  seq = 0
  const result = normalizePlans(GOLDEN_PLANS_INPUT, [], { now: NOW, newId: ids })
  assert.ok(result.ok, JSON.stringify(!result.ok && result.errors))
  return result.plans
}
const superior = () => goldenPlans().find(p => p.name === 'Superior')!

describe('normalizePlans — N planes con nombres libres', () => {
  test('crea los 3 planes del golden case, ordenados, con ids del servidor', () => {
    const plans = goldenPlans()
    assert.deepEqual(plans.map(p => p.name), ['Bronze', 'Premium', 'Superior'])
    assert.deepEqual(plans.map(p => p.id), ['plan-1', 'plan-2', 'plan-3'])
    assert.ok(plans.every(p => p.active))
  })
  test('soporta 1 plan y 5 planes con cualquier nombre', () => {
    for (const names of [['Evento VIP'], ['Starter', 'Gold', 'Platinum', 'Diamante', 'Evento VIP']]) {
      const r = normalizePlans(names.map((name, i) => ({ name, price: 1000 * (i + 1) })), [], { now: NOW, newId: ids })
      assert.ok(r.ok)
      assert.deepEqual(r.plans.map(p => p.name), names)
    }
  })
  test('Superior conserva todos sus atributos y usa 50/50 por defecto', () => {
    const plan = superior()
    assert.equal(plan.price, 750000)
    assert.equal(plan.currency, 'CLP')
    assert.equal(plan.influencer_minimum, 10)
    assert.equal(plan.influencer_minimum_label, '10+')
    assert.ok(plan.stand_included && plan.brand_brief_included && plan.influencer_content_included && plan.collaboration_included)
    assert.deepEqual(plan.payment_terms, {
      first_percentage: 50, first_condition: 'within_3bd_of_contract_sent',
      second_percentage: 50, second_condition: 'within_3bd_after_event',
    })
  })
  test('editar conserva id y created_at; desactivar no borra', () => {
    const existing = goldenPlans()
    const later = new Date('2026-10-01T12:00:00Z')
    const edited = existing.map(p => p.name === 'Superior' ? { ...p, price: 800000, influencer_minimum: 12 } : p.name === 'Bronze' ? { ...p, active: false } : p)
    const r = normalizePlans(edited, existing, { now: later, newId: ids })
    assert.ok(r.ok)
    const sup = r.plans.find(p => p.name === 'Superior')!
    assert.equal(sup.id, 'plan-3')
    assert.equal(sup.created_at, NOW.toISOString())
    assert.equal(sup.updated_at, later.toISOString())
    assert.equal(sup.price, 800000)
    assert.equal(r.plans.find(p => p.name === 'Bronze')!.active, false)
  })
  test('omitir un plan existente es error: no se borran planes', () => {
    const existing = goldenPlans()
    const r = normalizePlans(existing.slice(0, 2), existing, { now: NOW, newId: ids })
    assert.equal(r.ok, false)
    assert.ok(!r.ok && r.errors.some(e => e.plan_id === 'plan-3' && /desactívalo/.test(e.message)))
  })
  test('reporta todos los errores de validación', () => {
    const r = normalizePlans([
      { name: '', price: 0 },
      { name: 'Gold', price: 1000.5, currency: 'CLP' },
      { name: 'gold', price: 1000, currency: 'EUR' },
      { name: 'X', price: 100, payment_terms: { first_percentage: 60, second_percentage: 60 } },
      { name: 'Y', price: 100, influencer_minimum: 0 },
      { name: 'Z', price: 100, payment_terms: { first_condition: 'cuando_quiera' } },
    ], [], { now: NOW, newId: ids })
    assert.equal(r.ok, false)
    const fields = !r.ok ? r.errors.map(e => `${e.plan_index}:${e.field}`) : []
    for (const expected of ['0:name', '0:price', '1:price', '2:name', '2:currency', '3:payment_terms', '4:influencer_minimum', '5:payment_terms.first_condition']) {
      assert.ok(fields.includes(expected), `falta error ${expected} en ${fields.join(', ')}`)
    }
  })
  test('rechaza input que no es lista', () => {
    assert.equal(normalizePlans({ name: 'x' }).ok, false)
  })
  test('rechaza textos visibles que prometen publicaciones o exclusividad', () => {
    const r = normalizePlans([
      { name: 'A', price: 100, benefits: ['10 publicaciones garantizadas de 10 influencers'] },
      { name: 'B', price: 100, additional_terms: 'Las influencers tendrán exclusividad con la marca.' },
      { name: 'C', price: 100, description: 'Garantizamos la aceptación de la Collab.' },
    ], [], { now: NOW, newId: ids })
    assert.equal(r.ok, false)
    const fields = !r.ok ? r.errors.map(e => `${e.plan_index}:${e.field}`) : []
    assert.deepEqual(fields.sort(), ['0:benefits.0', '1:additional_terms', '2:description'])
  })
})

describe('findForbiddenPromises', () => {
  test('los textos protectores no se marcan', () => {
    for (const clause of [ACTIVATION_DYNAMICS_CLAUSE, NO_GUARANTEED_PUBLICATIONS_CLAUSE, NON_EXCLUSIVITY_CLAUSE, collaborationClause(true, '@cachantun'), collaborationClause(false, null)]) {
      assert.deepEqual(findForbiddenPromises(clause), [], clause)
    }
  })
  test('marca promesas afirmativas', () => {
    assert.equal(findForbiddenPromises('Garantizamos 10 publicaciones para tu marca.').length, 1)
    assert.equal(findForbiddenPromises('Las influencers publicarán contenido obligatoriamente.').length, 1)
    assert.equal(findForbiddenPromises('Exclusividad de las creadoras para la marca.').length, 1)
  })
  test('no marca beneficios legítimos', () => {
    assert.deepEqual(findForbiddenPromises('Categoría exclusiva de bebidas dentro del evento.'), [])
    assert.deepEqual(findForbiddenPromises('Espacio pensado para generar contenido.'), [])
    assert.deepEqual(findForbiddenPromises('Presencia destacada en la comunicación del evento.'), [])
  })
})

describe('DTO público', () => {
  test('nunca expone internal_notes ni timestamps', () => {
    const dto = toPublicPlan(superior()) as Record<string, unknown>
    assert.equal('internal_notes' in dto, false)
    assert.equal('created_at' in dto, false)
    assert.ok(!JSON.stringify(dto).includes('negociado'))
  })
  test('lista solo planes activos y ordenados', () => {
    const plans = goldenPlans().map(p => p.name === 'Premium' ? { ...p, active: false } : p)
    assert.deepEqual(listPublicPlans(plans).map(p => p.name), ['Bronze', 'Superior'])
  })
})

describe('snapshot', () => {
  test('modificar el plan después no altera el snapshot', () => {
    const plan = superior()
    const snapshot = toPlanSnapshot(plan, NOW)
    const frozen = JSON.stringify(snapshot)
    plan.price = 800000
    plan.influencer_minimum = 12
    plan.influencer_minimum_label = '12+'
    plan.benefits.push('Nuevo beneficio')
    plan.payment_terms.first_percentage = 30
    assert.equal(JSON.stringify(snapshot), frozen)
    assert.equal(snapshot.price, 750000)
    assert.equal(snapshot.influencer_minimum_label, '10+')
    assert.equal('internal_notes' in snapshot, false)
    assert.equal(snapshot.snapshot_at, NOW.toISOString())
  })
})

describe('readOpportunity — compatibilidad', () => {
  test('sin collaboration_opportunity → null', () => {
    assert.equal(readOpportunity({ address: 'x' }), null)
    assert.equal(readOpportunity(null), null)
  })
  test('config legacy sin plans[] → modo legacy intacto', () => {
    const view = readOpportunity({ collaboration_opportunity: { enabled: true, benefits: 'Stand', participation_value: 350000, currency: 'CLP', seats: 5, application_deadline: null } })
    assert.deepEqual(view, { mode: 'legacy', enabled: true, application_deadline: null, benefits: 'Stand', participation_value: 350000, currency: 'CLP', seats: 5 })
  })
  test('plans[] vacío también es legacy', () => {
    assert.equal(readOpportunity({ collaboration_opportunity: { enabled: false, plans: [] } })?.mode, 'legacy')
  })
  test('con planes → modo plans; descarta planes guardados corruptos', () => {
    const plans = goldenPlans()
    const view = readOpportunity({ collaboration_opportunity: { enabled: true, plans: [...plans, { id: 'x', name: '' }, 'basura'] } })
    assert.equal(view?.mode, 'plans')
    assert.equal(view?.mode === 'plans' && view.plans.length, 3)
  })
})

describe('cuenta de colaboración', () => {
  test('normaliza variantes al formato @cuenta', () => {
    for (const raw of ['cachantun', '@cachantun', '@Cachantun', 'https://www.instagram.com/cachantun/', 'instagram.com/cachantun?hl=es']) {
      assert.equal(normalizeCollaborationAccount(raw), GOLDEN_BRAND.collaborationAccount, raw)
    }
  })
  test('vacío → null; inválido → error', () => {
    assert.equal(normalizeCollaborationAccount('  '), null)
    assert.throws(() => normalizeCollaborationAccount('cachan tun'))
    assert.throws(() => normalizeCollaborationAccount('@a..b'))
  })
  test('Collab incluida exige cuenta', () => {
    assert.throws(() => collaborationClause(true, null))
  })
})

describe('montos', () => {
  test('750.000 → 375.000 + 375.000', () => {
    assert.deepEqual(splitPlanAmount(750000, 50), { first: 375000, second: 375000 })
  })
  test('montos impares suman exacto', () => {
    const { first, second } = splitPlanAmount(750001, 50)
    assert.equal(first + second, 750001)
  })
})

describe('ANEXO I — golden case Superior', () => {
  const annex = () => renderPlanAnnex({
    plan: toPublicPlan(superior()),
    collaborationAccount: GOLDEN_BRAND.collaborationAccount,
    brandName: GOLDEN_BRAND.name,
    campaignName: GOLDEN_CAMPAIGN.name,
    event: { name: GOLDEN_CAMPAIGN.event.name, date: '14 de noviembre de 2026', startTime: '18:00 hrs', location: GOLDEN_CAMPAIGN.event.location },
  })
  test('incluye precio, 10+, stand, brief, contenido, Collab y cuenta', () => {
    const text = annex()
    for (const expected of ['Superior', '$750.000', '10+ influencers', 'Stand de marca', 'Brief de marca', 'Contenido realizado por las influencers', '@cachantun', 'Centro Parque — Bar VRAVA', '18:00']) {
      assert.ok(text.includes(expected), `falta "${expected}"`)
    }
  })
  test('pagos 50/50 con plazos en días hábiles', () => {
    const text = annex()
    assert.ok(text.includes('50% ($375.000) dentro de los 3 días hábiles siguientes al envío del contrato'))
    assert.ok(text.includes('50% ($375.000) dentro de los 3 días hábiles siguientes a la finalización del evento'))
  })
  test('contiene las cláusulas protectoras y ninguna promesa prohibida', () => {
    const text = annex()
    assert.ok(text.includes(ACTIVATION_DYNAMICS_CLAUSE))
    assert.ok(text.includes(NO_GUARANTEED_PUBLICATIONS_CLAUSE))
    assert.ok(text.includes(NON_EXCLUSIVITY_CLAUSE))
    assert.ok(/no garantiza su aceptación/.test(text))
    assert.deepEqual(findForbiddenPromises(text), [])
  })
  test('no expone notas internas', () => {
    assert.ok(!annex().includes('negociado'))
  })
  test('ítems no incluidos aparecen como no incluidos, no como beneficios', () => {
    const bronze = goldenPlans().find(p => p.name === 'Bronze')!
    const text = renderPlanAnnex({ plan: toPublicPlan(bronze), collaborationAccount: null, brandName: 'X', campaignName: 'Y' })
    const [includedPart, excludedPart] = text.split('3. No incluido en este plan')
    assert.ok(!includedPart.includes('Stand de marca'))
    assert.ok(excludedPart.includes('- Stand de marca'))
    assert.ok(excludedPart.includes('Gestión de solicitudes de colaboración'))
    assert.ok(text.includes('El plan no incluye la gestión de solicitudes de colaboración'))
  })
  test('Collab incluida sin cuenta confirmada → lanza', () => {
    assert.throws(() => renderPlanAnnex({ plan: toPublicPlan(superior()), collaborationAccount: null, brandName: 'X', campaignName: 'Y' }))
  })
  test('appendPlanAnnex: una vez en el marcador, o al final', () => {
    assert.equal(appendPlanAnnex('A {{plan_annex}} B {{plan_annex}}', 'ANEXO'), 'A ANEXO B ')
    assert.equal(appendPlanAnnex('Contrato', 'ANEXO'), 'Contrato\n\nANEXO\n')
  })
})

describe('sin hardcode comercial en código nuevo', () => {
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../src/${rel}`, import.meta.url)), 'utf8')
  for (const file of ['lib/brand-plans.ts', 'lib/business-days.ts']) {
    test(`${file} no contiene nombres de planes ni presets`, () => {
      const source = read(file)
      assert.ok(!/\b(Bronze|Premium|Superior|Gold|Platinum)\b/.test(source))
      assert.ok(!/PACKAGE_PRESETS/.test(source))
      assert.ok(!/750\.?000|cachantun/i.test(source))
    })
  }
})
