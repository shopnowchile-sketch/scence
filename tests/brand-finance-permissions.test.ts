// owner y member acceden a la facturación y finanzas de SU marca; solo owner firma NDA y paga el plan.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'
import test from 'node:test'
import { roleHasBrandPermission } from '../src/lib/brand-permissions.ts'

register('./support/ts-resolve.mjs', import.meta.url)
register('./support/route-harness.mjs', import.meta.url)

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('facturación y finanzas: owner y member sí', () => {
  for (const role of ['owner', 'member'] as const) {
    for (const p of ['billing.read', 'billing.manage', 'financial_document.read', 'financial_document.manage'] as const) {
      assert.equal(roleHasBrandPermission(role, p), true, `${role} ${p}`)
    }
  }
})

test('solo owner: equipo, datos de la marca y documentos legales (NDA)', () => {
  for (const p of ['team.read', 'team.manage', 'brand.manage', 'legal_document.read', 'legal_document.manage'] as const) {
    assert.equal(roleHasBrandPermission('owner', p), true, `owner ${p}`)
    assert.equal(roleHasBrandPermission('member', p), false, `member ${p}`)
  }
})

test('la firma del NDA exige legal_document.manage y el pago del plan usa canPayBrandPlan (ambos solo owner)', () => {
  assert.match(source('src/app/api/brand/documents/[id]/route.ts'), /hasBrandPermission\(access, 'legal_document\.manage'\)/)
  for (const f of ['src/app/api/paypal/checkout/route.ts', 'src/app/api/paypal/complete/route.ts']) {
    assert.match(source(f), /canPayBrandPlan\(access\)/, f)
  }
})

test('pago del plan: owner pendiente o suspendido sí; member, rechazada y sin acceso no', async () => {
  const { canPayBrandPlan } = await import('../src/lib/supabase/ensureOrg.ts')
  const access = (role: 'owner' | 'member', status: string) => ({ brandId: 'b', organizationId: 'o', role, isOwner: role === 'owner', status })
  for (const status of ['approved', 'pending_approval', 'suspended']) assert.equal(canPayBrandPlan(access('owner', status)), true, `owner ${status}`)
  assert.equal(canPayBrandPlan(access('owner', 'rejected')), false)
  for (const status of ['approved', 'pending_approval', 'suspended']) assert.equal(canPayBrandPlan(access('member', status)), false, `member ${status}`)
  assert.equal(canPayBrandPlan(null), false)
})
