// Una marca pendiente abre perfil, facturación y documentos; no campañas ni influencers (decisión 2026-10-26).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { brandStatusAllows, pendingBrandPathAllowed } from '../src/lib/brand-status-access.ts'

test('páginas permitidas para una marca pendiente', () => {
  for (const path of ['/brand-settings/organization', '/brand-settings/profile', '/brand-settings/plan', '/brand-billing', '/brand-documents', '/brand-billing/otra']) {
    assert.equal(pendingBrandPathAllowed(path), true, path)
  }
})

test('páginas operativas siguen bloqueadas', () => {
  for (const path of ['/brand-dash', '/brand-campaigns', '/brand-campaigns/abc', '/brand-influencers', '/brand-brands', '/brand-opportunities', '/brand-settings/users', '/brand-settings/locations', '/brand-billingx', '/brand-documentsx']) {
    assert.equal(pendingBrandPathAllowed(path), false, path)
  }
})

test('el servidor respalda la misma regla: pendiente consulta facturación y documentos, no opera', () => {
  assert.equal(brandStatusAllows('pending_approval', 'profile'), true)
  assert.equal(brandStatusAllows('pending_approval', 'onboarding'), true)
  assert.equal(brandStatusAllows('pending_approval', 'billing'), true)
  assert.equal(brandStatusAllows('pending_approval', 'billing_manage'), false)
  assert.equal(brandStatusAllows('pending_approval', 'operate'), false)
})

test('el layout del portal usa el helper y solo para pending_approval', () => {
  const layout = readFileSync(new URL('../src/app/(brand)/layout.tsx', import.meta.url), 'utf8')
  assert.match(layout, /brandStatus === 'pending_approval' && pendingBrandPathAllowed\(pathname\)/)
})
