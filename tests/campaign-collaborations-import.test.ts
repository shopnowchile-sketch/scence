// Importación de colaboradoras existentes (campaign_brands → ficha nueva) y resolución de contratos.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { planCollaboratorImport, resolveContractBrandId } from '../src/lib/campaign-collaborations-shared.ts'

const BM = 'brand-bmodel', VI = 'brand-vitis', DR = 'brand-dra'
const names = new Map([[BM, 'BModel Management'], [VI, 'Vitis-Phb'], [DR, 'Dra Carolina Lasserre']])
const base = { collaboratorBrandIds: [BM, VI, DR], brandNames: names, leadsByBrand: new Map<string, string[]>(), existing: [] as { brand_id: string | null; lead_id: string | null }[] }

test('importa las tres colaboradoras de Launch por su relación real (sin inferir por nombre)', () => {
  const plan = planCollaboratorImport(base)
  assert.deepEqual(plan.toInsert.map(i => i.name), ['BModel Management', 'Vitis-Phb', 'Dra Carolina Lasserre'])
  assert.deepEqual(plan.toInsert.map(i => i.brand_id), [BM, VI, DR])
  assert.equal(plan.needsReview.length, 0)
})

test('idempotente: una segunda ejecución no importa nada nuevo', () => {
  const first = planCollaboratorImport(base)
  const existing = first.toInsert.map(i => ({ brand_id: i.brand_id, lead_id: i.lead_id }))
  const second = planCollaboratorImport({ ...base, existing })
  assert.equal(second.toInsert.length, 0)
  assert.equal(second.alreadyPresent.length, 3)
})

test('no toca lo que ya existe: solo importa la que falta', () => {
  const plan = planCollaboratorImport({ ...base, existing: [{ brand_id: BM, lead_id: null }, { brand_id: VI, lead_id: null }] })
  assert.deepEqual(plan.toInsert.map(i => i.brand_id), [DR])
  assert.deepEqual(plan.alreadyPresent, ['BModel Management', 'Vitis-Phb'])
})

test('no duplica si la marca ya está en la ficha a través de su lead convertido', () => {
  const plan = planCollaboratorImport({ ...base, collaboratorBrandIds: [BM], leadsByBrand: new Map([[BM, ['lead-bm']]]), existing: [{ brand_id: null, lead_id: 'lead-bm' }] })
  assert.equal(plan.toInsert.length, 0)
  assert.deepEqual(plan.alreadyPresent, ['BModel Management'])
})

test('un lead convertido se enlaza (notas/historial); varios leads → solo marca y se avisa', () => {
  const one = planCollaboratorImport({ ...base, collaboratorBrandIds: [BM], leadsByBrand: new Map([[BM, ['lead-bm']]]) })
  assert.equal(one.toInsert[0].lead_id, 'lead-bm')
  const many = planCollaboratorImport({ ...base, collaboratorBrandIds: [BM], leadsByBrand: new Map([[BM, ['l1', 'l2']]]) })
  assert.equal(many.toInsert[0].lead_id, null)
  assert.deepEqual(many.ambiguousLeads, ['BModel Management'])
})

test('marca que no se puede resolver: no se importa y se informa para revisión manual', () => {
  const plan = planCollaboratorImport({ ...base, collaboratorBrandIds: [BM, 'brand-fantasma'] })
  assert.deepEqual(plan.toInsert.map(i => i.brand_id), [BM])
  assert.equal(plan.needsReview.length, 1)
  assert.equal(plan.needsReview[0].brand_id, 'brand-fantasma')
})

test('marcas repetidas en la entrada no generan duplicados', () => {
  const plan = planCollaboratorImport({ ...base, collaboratorBrandIds: [BM, BM, BM] })
  assert.equal(plan.toInsert.length, 1)
})

test('contrato: marca existente, lead convertido y lead sin convertir', () => {
  assert.equal(resolveContractBrandId('brand-x', null), 'brand-x')          // marca existente
  assert.equal(resolveContractBrandId(null, 'brand-conv'), 'brand-conv')    // lead convertido (crm_leads.converted_brand_id)
  assert.equal(resolveContractBrandId(null, null), null)                    // lead aún no convertido
  assert.equal(resolveContractBrandId('brand-x', 'brand-otra'), 'brand-x')  // la asociación directa manda
})

test('la ruta de importación solo inserta; nunca actualiza ni borra colaboraciones existentes', () => {
  const route = readFileSync(new URL('../src/app/api/campaigns/[id]/collaborations/import/route.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(route, /\.update\(|\.delete\(|\.upsert\(/)
  assert.match(route, /23505/)
})

test('la pestaña Contrato busca por la marca resuelta (marca directa o lead convertido)', () => {
  const tab = readFileSync(new URL('../src/components/campaigns/CollaboratingBrandsTab.tsx', import.meta.url), 'utf8')
  assert.match(tab, /c\.brand_id === row\.contract_brand_id/)
  const lib = readFileSync(new URL('../src/lib/campaign-collaborations.ts', import.meta.url), 'utf8')
  assert.match(lib, /resolveContractBrandId\(row\.brand_id, lead\?\.converted_brand_id/)
})

test('rollback: revierte solo los objetos de la migración y en orden de dependencias', () => {
  const sql = readFileSync(new URL('../supabase/rollbacks/20261009120000_campaign_brand_collaborations_ROLLBACK.sql', import.meta.url), 'utf8')
  const drops = [...sql.matchAll(/^(?:DROP (?:INDEX|TABLE)|ALTER TABLE)[^;]*;/gm)].map(m => m[0])
  assert.equal(drops.length, 4)
  const iCollabs = sql.indexOf('DROP TABLE IF EXISTS public.campaign_brand_collaborations')
  const iPlans = sql.indexOf('DROP TABLE IF EXISTS public.campaign_collaboration_plans')
  assert.ok(iCollabs > 0 && iPlans > iCollabs, 'colaboraciones antes que planes (FK plan_id)')
  assert.doesNotMatch(sql, /DROP TABLE[^;]*(crm_leads|brands|campaign_brands|contracts|campaigns)\b(?!_)/i)
  assert.match(sql, /BEGIN;[\s\S]*COMMIT;/)
})
