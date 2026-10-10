import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { shouldHandOffToBrand, BRAND_HANDOFF_STATUSES } from '../src/lib/crm-brand-handoff.ts'

const route = readFileSync(new URL('../src/app/api/crm-leads/[id]/route.ts', import.meta.url), 'utf8')

describe('CRM → Marcas: pase al marcar "Interesada"', () => {
  test('interesada, armando campaña y cerrada crean la marca si el lead aún no tiene una', () => {
    for (const status of ['interested', 'building', 'converted']) assert.equal(shouldHandOffToBrand(status, null), true, status)
    assert.deepEqual([...BRAND_HANDOFF_STATUSES], ['interested', 'building', 'converted'])
  })

  test('sin calificar, contactada, descartada o legado no crean marca', () => {
    for (const status of ['unqualified', 'contacted', 'rejected', 'qualified', undefined, '']) assert.equal(shouldHandOffToBrand(status, null), false, String(status))
  })

  test('idempotente: si ya tiene marca no se crea otra', () => {
    for (const status of BRAND_HANDOFF_STATUSES) assert.equal(shouldHandOffToBrand(status, 'brand-1'), false)
  })

  test('la ruta usa el helper, vincula la marca existente por email y la organización propia de la marca', () => {
    assert.ok(route.includes('shouldHandOffToBrand(body.qualification_status, data.converted_brand_id)'))
    assert.ok(route.includes(".ilike('contact_email'"), 'no duplica marcas con el mismo email de contacto')
    assert.ok(route.includes('provisionOrgForBrand(brandName)'), 'una marca = una organización propia')
    assert.ok(!route.includes("body.qualification_status === 'converted' && !data.converted_brand_id"), 'ya no depende solo de "converted"')
  })
})
