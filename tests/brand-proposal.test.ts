// Commit 3 — propuesta comercial (src/lib/brand-proposal.ts) y fuente única
// de escritura de planes.   node --test tests/brand-proposal.test.ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { GOLDEN_BRAND, GOLDEN_CAMPAIGN, GOLDEN_PLANS_INPUT } from './fixtures/golden-launch-experience.ts'

// brand-proposal.ts importa módulos locales sin extensión (como los resuelve Next).
register('./support/ts-resolve.mjs', import.meta.url)
const P = await import('../src/lib/brand-proposal.ts')
const Plans = await import('../src/lib/brand-plans.ts')
type BrandPlan = import('../src/lib/brand-plans.ts').BrandPlan
type ApplicationDetails = import('../src/lib/brand-proposal.ts').ApplicationDetails

const ISSUED = new Date('2026-09-28T13:00:00Z') // lun 28-sep-2026 10:00 Chile

function plans(): BrandPlan[] {
  let seq = 0
  const r = Plans.normalizePlans(GOLDEN_PLANS_INPUT, [], { now: ISSUED, newId: () => `plan-${++seq}` })
  assert.ok(r.ok)
  return r.plans
}
const superior = () => plans().find(p => p.name === 'Superior')!

function issueInput(plan: BrandPlan = superior(), at: Date = ISSUED, account: string | null = GOLDEN_BRAND.collaborationAccount) {
  return {
    plan_id: plan.id,
    plan_snapshot: Plans.toPlanSnapshot(plan, at),
    collaboration_account: account,
    brand_snapshot: { id: 'brand-A', name: GOLDEN_BRAND.name },
    campaign_snapshot: {
      id: 'campaign-1', name: GOLDEN_CAMPAIGN.name, description: null,
      event: { name: GOLDEN_CAMPAIGN.event.name, date: GOLDEN_CAMPAIGN.event.date, start_time: GOLDEN_CAMPAIGN.event.startTime, location: GOLDEN_CAMPAIGN.event.location, source: 'override' as const },
    },
    issued_at: at.toISOString(),
    issued_by: 'admin-user',
  }
}

function issued(details: ApplicationDetails = {}, input = issueInput(), options = {}) {
  const r = P.applyIssue(details, input, options)
  assert.ok(r.ok, !r.ok ? r.error : '')
  return r
}

describe('fechas (golden case)', () => {
  test('vigencia 7 días corridos y aceptación 3 días hábiles', () => {
    const d = P.computeProposalDeadlines(ISSUED)
    assert.equal(d.valid_until, '2026-10-06T02:59:59.999Z') // lun 05-oct 23:59:59 Chile
    assert.equal(d.accept_by, '2026-10-02T02:59:59.999Z')   // jue 01-oct 23:59:59 Chile
  })
  test('el plazo efectivo es el menor de ambos', () => {
    assert.equal(P.effectiveAcceptanceDeadline({ valid_until: '2026-10-01T00:00:00Z', accept_by: '2026-10-03T00:00:00Z' }).toISOString(), '2026-10-01T00:00:00.000Z')
  })
})

describe('emisión y contenido', () => {
  test('v1 enviada con las 10 secciones en orden', () => {
    const { proposal } = issued()
    assert.equal(proposal.version, 1)
    assert.equal(proposal.status, 'sent')
    assert.equal(proposal.commercial_model, 'brand_activation_plan')
    const headings = ['01 — RESUMEN DE LA PROPUESTA', '02 — SOBRE', '03 — PLAN SUPERIOR', '04 — DINÁMICA DE INFLUENCERS Y CONTENIDO', '05 — ALCANCE DE SCENCE', '06 — RESPONSABILIDADES DE LA MARCA', '07 — INVERSIÓN Y CONDICIONES COMERCIALES', '08 — EXCLUSIONES Y CAMBIOS DE ALCANCE', '09 — PRÓXIMOS PASOS', '10 — ACEPTACIÓN DE LA PROPUESTA']
    let last = -1
    for (const h of headings) {
      const at = proposal.content.indexOf(h)
      assert.ok(at > last, `sección fuera de orden o ausente: ${h}`)
      last = at
    }
  })
  test('golden case: $750.000, 10+, stand, brief, contenido, Collab, cuenta, evento', () => {
    const { content } = issued().proposal
    for (const expected of ['CACHANTUN / CCU', 'SCENCE Launch Experience', 'con el plan Superior', '$750.000', '10+ influencers', 'Stand de marca', 'Brief de marca', 'Contenido realizado por las influencers', '@cachantun', 'Centro Parque — Bar VRAVA', '18:00 hrs', '14 de noviembre de 2026']) {
      assert.ok(content.includes(expected), `falta "${expected}"`)
    }
  })
  test('textos protectores obligatorios y ninguna promesa prohibida', () => {
    const { content } = issued().proposal
    assert.ok(content.includes(Plans.ACTIVATION_DYNAMICS_CLAUSE))
    assert.ok(content.includes(Plans.NO_GUARANTEED_PUBLICATIONS_CLAUSE))
    assert.ok(content.includes(Plans.NON_EXCLUSIVITY_CLAUSE))
    assert.ok(content.includes('no garantiza su aceptación'))
    assert.ok(content.includes('no una cantidad de publicaciones'))
    assert.deepEqual(Plans.findForbiddenPromises(content), [])
  })
  test('vigencia y plazo de aceptación explícitos en la sección 10', () => {
    const { content } = issued().proposal
    assert.ok(content.includes('vigencia de 7 días corridos'))
    assert.ok(content.includes('dentro de 3 días hábiles desde su recepción'))
    assert.ok(content.includes('1 de octubre de 2026'))
    assert.ok(content.includes('5 de octubre de 2026'))
  })
  test('50/50 del golden case sale de payment_terms', () => {
    const { content } = issued().proposal
    assert.ok(content.includes('50% ($375.000) dentro de los 3 días hábiles siguientes al envío del contrato'))
    assert.ok(content.includes('50% ($375.000) dentro de los 3 días hábiles siguientes a la finalización del evento'))
  })
  test('otras condiciones de pago se renderizan desde el plan, sin texto fijo', () => {
    const plan = { ...superior(), payment_terms: { first_percentage: 30, first_condition: 'on_signing' as const, second_percentage: 70, second_condition: 'before_event' as const } }
    const { content } = issued({}, issueInput(plan)).proposal
    assert.ok(content.includes('30% ($225.000) a la firma del presente acuerdo'))
    assert.ok(content.includes('70% ($525.000) antes de la realización del evento'))
    assert.ok(!content.includes('3 días hábiles siguientes al envío'))
  })
  test('Collab incluida sin cuenta → error; plan sin Collab no la exige', () => {
    assert.throws(() => P.applyIssue({}, issueInput(superior(), ISSUED, null)))
    const bronze = plans().find(p => p.name === 'Bronze')!
    const { content } = issued({}, issueInput(bronze, ISSUED, null)).proposal
    assert.ok(content.includes('El plan no incluye la gestión de solicitudes de colaboración'))
    assert.ok(content.includes('No incluido: Stand de marca.'))
  })
  test('determinista: mismo input → mismo texto', () => {
    assert.equal(issued().proposal.content, issued().proposal.content)
  })
})

describe('snapshot', () => {
  test('editar el plan después de emitir no cambia la propuesta', () => {
    const plan = superior()
    const { proposal } = issued({}, issueInput(plan))
    const frozen = JSON.stringify(proposal)
    plan.price = 800000
    plan.influencer_minimum_label = '12+'
    plan.benefits.push('Nuevo')
    plan.payment_terms.first_percentage = 30
    assert.equal(JSON.stringify(proposal), frozen)
    assert.equal(proposal.plan_snapshot.price, 750000)
    assert.ok(proposal.content.includes('$750.000') && !proposal.content.includes('$800.000'))
  })
  test('el snapshot no contiene notas internas', () => {
    const { proposal } = issued()
    assert.ok(!JSON.stringify(proposal).includes('negociado'))
  })
})

describe('estados y vencimiento', () => {
  const accepted = (details: ApplicationDetails, now: Date) => P.applyAccept(details, { userId: 'brand-user', ip: '1.2.3.4', now })
  test('aceptar dentro de plazo → accepted con evidencia', () => {
    const r = accepted(issued().details, new Date('2026-10-01T20:00:00Z'))
    assert.ok(r.ok)
    assert.equal(r.proposal.status, 'accepted')
    assert.equal(r.proposal.accepted_by, 'brand-user')
    assert.equal(r.proposal.acceptance_ip, '1.2.3.4')
  })
  test('borde exacto: 23:59:59.999 del jueves acepta; 00:00 del viernes vence', () => {
    const { details } = issued()
    assert.ok(accepted(details, new Date('2026-10-02T02:59:59.999Z')).ok)
    const late = accepted(details, new Date('2026-10-02T03:00:00.000Z'))
    assert.equal(late.ok, false)
    assert.ok(!late.ok && late.status === 409 && late.details?.proposal?.status === 'expired')
  })
  test('estado efectivo expired sin cron', () => {
    const { proposal } = issued()
    assert.equal(P.effectiveProposalStatus(proposal, new Date('2026-10-01T12:00:00Z')), 'sent')
    assert.equal(P.effectiveProposalStatus(proposal, new Date('2026-10-03T12:00:00Z')), 'expired')
  })
  test('no se acepta dos veces', () => {
    const first = accepted(issued().details, new Date('2026-09-29T12:00:00Z'))
    assert.ok(first.ok)
    const second = accepted(first.details, new Date('2026-09-29T13:00:00Z'))
    assert.equal(second.ok, false)
  })
  test('retirar: solo enviada o vencida; la marca deja de verla', () => {
    const w = P.applyWithdraw(issued().details, { userId: 'admin', now: new Date('2026-09-29T12:00:00Z') })
    assert.ok(w.ok)
    assert.equal(w.proposal.status, 'withdrawn')
    assert.equal(P.toBrandProposalView(w.proposal), null)
    const acc = accepted(issued().details, new Date('2026-09-29T12:00:00Z'))
    assert.ok(acc.ok)
    assert.equal(P.applyWithdraw(acc.details, { userId: 'admin' }).ok, false)
  })
})

describe('reemisión', () => {
  const later = (days: number) => new Date(ISSUED.getTime() + days * 86400000)
  test('v1 → v2: la anterior queda en historial como superseded', () => {
    const v1 = issued()
    const v2 = issued(v1.details, issueInput(superior(), later(1)))
    assert.equal(v2.proposal.version, 2)
    assert.equal(v2.details.proposal_history?.length, 1)
    assert.equal(v2.details.proposal_history?.[0].status, 'superseded')
    assert.equal(v2.details.proposal_history?.[0].version, 1)
  })
  test('reemitir sobre aceptada exige confirmación explícita', () => {
    const acc = P.applyAccept(issued().details, { userId: 'u', now: later(1) })
    assert.ok(acc.ok)
    const blocked = P.applyIssue(acc.details, issueInput(superior(), later(2)))
    assert.equal(blocked.ok, false)
    const forced = issued(acc.details, issueInput(superior(), later(2)), { replaceAccepted: true })
    assert.equal(forced.proposal.version, 2)
    assert.equal(forced.details.proposal_history?.[0].status, 'superseded')
  })
  test('con contrato asociado nunca se reemplaza', () => {
    const v1 = issued()
    const withContract = { ...v1.details, proposal: { ...v1.proposal, contract_id: 'c-1' } }
    assert.equal(P.applyIssue(withContract, issueInput(superior(), later(1)), { replaceAccepted: true }).ok, false)
  })
  test('una retirada se conserva como retirada en el historial', () => {
    const w = P.applyWithdraw(issued().details, { userId: 'admin', now: later(1) })
    assert.ok(w.ok)
    const v2 = issued(w.details, issueInput(superior(), later(2)))
    assert.equal(v2.details.proposal_history?.[0].status, 'withdrawn')
    assert.equal(v2.proposal.version, 2)
  })
  test('reemitir conserva los datos de la postulación de la marca', () => {
    const v = issued({ sampling: 'agua', requested_plan_id: 'plan-3' })
    assert.equal(v.details.sampling, 'agua')
    assert.equal(v.details.requested_plan_id, 'plan-3')
  })
})

describe('vista de marca', () => {
  test('sin ids internos, IP, historial ni autor', () => {
    const acc = P.applyAccept(issued().details, { userId: 'brand-user', ip: '9.9.9.9', now: new Date('2026-09-29T12:00:00Z') })
    assert.ok(acc.ok)
    const view = P.toBrandProposalView(acc.proposal) as Record<string, unknown>
    for (const hidden of ['issued_by', 'accepted_by', 'acceptance_ip', 'proposal_history', 'contract_id']) assert.equal(hidden in view, false, hidden)
    assert.equal(view.status, 'accepted')
  })
})

describe('aislamiento Marca A / Marca B', () => {
  const rows = [
    { id: 'app-A', campaign_id: 'c1', brand_id: 'brand-A', status: 'pending', details: {}, updated_at: 't' },
    { id: 'app-B', campaign_id: 'c1', brand_id: 'brand-B', status: 'pending', details: {}, updated_at: 't' },
  ]
  function fakeAdmin() {
    const calls: Array<[string, string]> = []
    const builder = {
      filters: {} as Record<string, string>,
      select() { return this },
      eq(column: string, value: string) { this.filters[column] = value; calls.push([column, value]); return this },
      async maybeSingle() {
        const f = this.filters
        return { data: rows.find(r => Object.entries(f).every(([k, v]) => (r as Record<string, unknown>)[k] === v)) ?? null, error: null }
      },
    }
    return { client: { from: () => { builder.filters = {}; return builder } }, calls }
  }
  test('marca A lee su propuesta', async () => {
    const { client } = fakeAdmin()
    const row = await P.loadBrandOwnApplication(client as never, 'app-A', 'brand-A')
    assert.equal(row?.id, 'app-A')
  })
  test('marca B no puede leer ni aceptar la propuesta de A (null → 404)', async () => {
    const { client, calls } = fakeAdmin()
    assert.equal(await P.loadBrandOwnApplication(client as never, 'app-A', 'brand-B'), null)
    assert.ok(calls.some(([c, v]) => c === 'brand_id' && v === 'brand-B'))
  })
  test('las rutas de marca solo cargan vía loadBrandOwnApplication y escriben filtrando brand_id', () => {
    const route = readFileSync(fileURLToPath(new URL('../src/app/api/brand/proposals/[applicationId]/route.ts', import.meta.url)), 'utf8')
    assert.equal((route.match(/loadBrandOwnApplication\(admin, params\.applicationId, access\.brandId\)/g) ?? []).length, 2)
    assert.equal((route.match(/\.eq\('brand_id', access\.brandId\)/g) ?? []).length, 2)
    assert.ok(!/from\('campaign_brand_applications'\)\s*\.select/.test(route))
  })
})

describe('fuente única de escritura de planes', () => {
  const saved = { enabled: true, plans: [{ id: 'p1', name: 'X' }] }
  test('la edición general no puede modificar, inyectar ni borrar la configuración', () => {
    const existing = { address: 'a', collaboration_opportunity: saved }
    const tampered = Plans.guardCollaborationOpportunity(existing, { address: 'b', collaboration_opportunity: { enabled: true, plans: [] } }) as Record<string, unknown>
    assert.deepEqual(tampered.collaboration_opportunity, saved)
    assert.equal(tampered.address, 'b')
    const omitted = Plans.guardCollaborationOpportunity(existing, { address: 'c' }) as Record<string, unknown>
    assert.deepEqual(omitted.collaboration_opportunity, saved)
    const nulled = Plans.guardCollaborationOpportunity(existing, { collaboration_opportunity: null }) as Record<string, unknown>
    assert.deepEqual(nulled.collaboration_opportunity, saved)
  })
  test('creación y duplicado nunca traen planes', () => {
    const created = Plans.guardCollaborationOpportunity({}, { collaboration_opportunity: saved, address: 'x' }) as Record<string, unknown>
    assert.equal('collaboration_opportunity' in created, false)
  })
  test('todas las rutas de edición/creación general pasan por el guard', () => {
    const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../src/${rel}`, import.meta.url)), 'utf8')
    const detail = read('app/api/campaigns/[id]/route.ts')
    assert.equal((detail.match(/guardCollaborationOpportunity\(guardRow\?\.metadata, (rest|fields)\.metadata\)/g) ?? []).length, 2)
    assert.ok(detail.indexOf('rest.metadata = guardCollaborationOpportunity') < detail.indexOf('.update({ ...rest'))
    assert.ok(detail.indexOf('fields.metadata = guardCollaborationOpportunity') < detail.indexOf('.update({ ...fields'))
    const brandDetail = read('app/api/brand/campaigns/[id]/route.ts')
    assert.ok(brandDetail.indexOf('guardCollaborationOpportunity(campaignBase.metadata, updates.metadata)') < brandDetail.indexOf('.update(updates)'))
    assert.ok(read('app/api/brand/campaigns/route.ts').includes('metadata: guardCollaborationOpportunity({}, {'))
    assert.ok(read('app/api/campaigns/[id]/duplicate/route.ts').includes('metadata: guardCollaborationOpportunity({}, source.metadata ?? {})'))
    assert.ok(read('app/api/campaigns/[id]/collaboration-opportunity/route.ts').includes('collaboration_opportunity: result.config'))
  })
})

describe('rutas y UI (verificación de código)', () => {
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../src/${rel}`, import.meta.url)), 'utf8')
  test('emisión/retiro solo para Admin de plataforma', () => {
    const route = read('app/api/campaigns/[id]/brand-proposals/route.ts')
    assert.ok(route.includes('if (!auth || !auth.isPlatformAdmin)'))
    assert.ok(route.includes("view.mode !== 'plans' || !view.enabled"))
  })
  test('emails con audiencia declarada vía getResend()', () => {
    const notify = read('lib/brand-proposal-notify.ts')
    assert.ok(notify.includes("emailAudience('brand')") && notify.includes("emailAudience('admin')"))
    assert.ok(!/new Resend\(/.test(notify))
  })
  test('una postulación viva no se pisa (antes el upsert reseteaba estado y borraba la propuesta)', () => {
    const route = read('app/api/brand/collaboration-opportunities/route.ts')
    assert.ok(route.includes("if (existing && existing.status !== 'rejected')"))
  })
  test('la UI no hardcodea condiciones de pago', () => {
    for (const file of ['components/campaigns/CollaborationOpportunitySettings.tsx', 'app/(brand)/brand-opportunities/page.tsx', 'components/campaigns/BrandProposalsPanel.tsx']) {
      assert.ok(!/días hábiles siguientes|al envío del contrato|tras el evento/.test(read(file)), file)
    }
  })
  test('sin nombres de plan ni datos del golden case en src nuevo', () => {
    for (const file of ['lib/brand-proposal.ts', 'lib/brand-proposal-notify.ts', 'lib/brand-proposal-pdf.ts', 'components/campaigns/BrandProposalsPanel.tsx', 'app/api/campaigns/[id]/brand-proposals/route.ts', 'app/api/brand/proposals/[applicationId]/route.ts']) {
      const source = read(file)
      assert.ok(!/\b(Bronze|Premium|Superior|Gold|Platinum)\b/.test(source), file)
      assert.ok(!/cachantun|VRAVA|750\.?000/i.test(source), file)
    }
  })
})
