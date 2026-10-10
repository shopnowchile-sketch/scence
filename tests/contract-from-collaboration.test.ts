// Pruebas de la resolución de condiciones comerciales desde la colaboración.
// Cliente simulado; los índices únicos de `contracts` se verificaron aparte
// contra el esquema real (ver informe). Sin datos reales.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { resolveCollaborationContractTerms, validatePaymentSplit, findExistingBrandContract } from '../src/lib/contract-from-collaboration.ts'

type Rows = Record<string, any>

function fakeAdmin(rows: Rows) {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = []
      const chain: any = {
        select() { return chain },
        eq(col: string, val: unknown) { filters.push([col, val]); return chain },
        limit() { return chain },
        maybeSingle() {
          const entry = rows[table]
          const data = typeof entry === 'function' ? entry(filters) : entry
          return Promise.resolve({ data: data ?? null, error: null })
        },
      }
      return chain
    },
  } as any
}

const collab = { id: 'c1', campaign_id: 'camp1', lead_id: null, brand_id: 'b1', status: 'confirmed', plan_id: 'p1' }
const plan = { id: 'p1', name: 'Gold', amount: '350000.00' }

describe('resolveCollaborationContractTerms', () => {
  test('colaboración confirmada con plan y monto: toma marca, nombre y monto del servidor', async () => {
    const r = await resolveCollaborationContractTerms(fakeAdmin({ campaign_brand_collaborations: collab, campaign_collaboration_plans: plan }), 'camp1', 'c1')
    assert.deepEqual(r, { ok: true, terms: { collaborationId: 'c1', planId: 'p1', partnerBrandId: 'b1', packageName: 'Gold', packageAmount: 350000 } })
  })

  test('colaboración de otra campaña o inexistente => 404', async () => {
    const r = await resolveCollaborationContractTerms(fakeAdmin({ campaign_brand_collaborations: null }), 'camp1', 'c1')
    assert.equal(r.ok, false); assert.equal((r as any).status, 404)
  })

  for (const status of ['to_contact', 'contacted', 'negotiating', 'declined']) {
    test(`estado "${status}" => 422`, async () => {
      const r = await resolveCollaborationContractTerms(fakeAdmin({ campaign_brand_collaborations: { ...collab, status }, campaign_collaboration_plans: plan }), 'camp1', 'c1')
      assert.equal(r.ok, false); assert.equal((r as any).status, 422)
    })
  }

  test('sin plan => 422', async () => {
    const r = await resolveCollaborationContractTerms(fakeAdmin({ campaign_brand_collaborations: { ...collab, plan_id: null } }), 'camp1', 'c1')
    assert.equal(r.ok, false); assert.match((r as any).error, /plan asignado/)
  })

  test('plan de otra campaña => 422', async () => {
    const r = await resolveCollaborationContractTerms(fakeAdmin({ campaign_brand_collaborations: collab, campaign_collaboration_plans: null }), 'camp1', 'c1')
    assert.equal(r.ok, false); assert.match((r as any).error, /no pertenece a esta campaña/)
  })

  for (const amount of [null, 0, '0.00', -5]) {
    test(`plan con monto ${JSON.stringify(amount)} => 422, no inventa valor`, async () => {
      const r = await resolveCollaborationContractTerms(fakeAdmin({ campaign_brand_collaborations: collab, campaign_collaboration_plans: { ...plan, amount } }), 'camp1', 'c1')
      assert.equal(r.ok, false); assert.match((r as any).error, /no tiene un monto definido/)
    })
  }

  test('solo lead sin marca convertida => 422', async () => {
    const r = await resolveCollaborationContractTerms(fakeAdmin({
      campaign_brand_collaborations: { ...collab, brand_id: null, lead_id: 'lead1' },
      crm_leads: { converted_brand_id: null },
      campaign_collaboration_plans: plan,
    }), 'camp1', 'c1')
    assert.equal(r.ok, false); assert.match((r as any).error, /marca asociada/)
  })

  test('lead convertido: usa la marca convertida', async () => {
    const r = await resolveCollaborationContractTerms(fakeAdmin({
      campaign_brand_collaborations: { ...collab, brand_id: null, lead_id: 'lead1' },
      crm_leads: { converted_brand_id: 'b9' },
      campaign_collaboration_plans: plan,
    }), 'camp1', 'c1')
    assert.equal(r.ok, true); assert.equal((r as any).terms.partnerBrandId, 'b9')
  })
})

describe('validatePaymentSplit', () => {
  test('50/50 y 30/70 son válidos', () => {
    assert.equal(validatePaymentSplit({ first_percentage: 50, second_percentage: 50 }), null)
    assert.equal(validatePaymentSplit({ first_percentage: 30, second_percentage: 70 }), null)
  })
  test('no suman 100 o son inválidos', () => {
    assert.ok(validatePaymentSplit({ first_percentage: 50, second_percentage: 40 }))
    assert.ok(validatePaymentSplit({ first_percentage: 0, second_percentage: 100 }))
    assert.ok(validatePaymentSplit({ first_percentage: NaN, second_percentage: 50 }))
  })
  test('sin pago no valida (el servidor exige payment_terms vía campos obligatorios)', () => {
    assert.equal(validatePaymentSplit(undefined), null)
  })
})

describe('findExistingBrandContract', () => {
  test('devuelve el contrato existente de la marca en la campaña', async () => {
    const { existing } = await findExistingBrandContract(fakeAdmin({ contracts: { id: 'k1', status: 'draft', title: 'x' } }), 'camp1', 'b1')
    assert.equal(existing?.id, 'k1')
  })
  test('null si no hay', async () => {
    const { existing } = await findExistingBrandContract(fakeAdmin({ contracts: null }), 'camp1', 'b1')
    assert.equal(existing, null)
  })
})
