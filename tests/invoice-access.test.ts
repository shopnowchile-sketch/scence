// Matriz de permisos de facturas (decideInvoiceAccess). Pura: sin red ni base.
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('./support/ts-resolve.mjs', import.meta.url)
const { decideInvoiceAccess, redactInvoiceForShare, isUuid } = await import('../src/lib/invoice-access.ts')

type Role = 'owner' | 'brand_manager' | 'member' | 'finance' // brand_manager y finance son valores heredados: se tratan como member
const brand = (brandId: string, role: Role) => ({ brandId, role })
const base = { isPlatformAdmin: false, brand: null, ownerBrandId: 'brand-A' as string | null, shareActive: false }
const NONE = { read: false, edit: false, send: false, markPaid: false, voidOrOverdue: false, delete: false, share: false }

test('admin de plataforma: todo, también sobre facturas sin propietario', () => {
  for (const ownerBrandId of ['brand-A', 'brand-B', null]) {
    const c = decideInvoiceAccess({ ...base, isPlatformAdmin: true, ownerBrandId })
    assert.equal(c.actor, 'platform_admin')
    assert.ok(c.read && c.edit && c.send && c.markPaid && c.voidOrOverdue && c.delete && c.share)
  }
})

test('marca propietaria con billing (owner y member): gestiona, pero NUNCA void ni mark_overdue', () => {
  for (const role of ['owner', 'member'] as Role[]) {
    const c = decideInvoiceAccess({ ...base, brand: brand('brand-A', role) })
    assert.equal(c.actor, 'owner_brand', role)
    assert.ok(c.read && c.edit && c.send && c.markPaid && c.delete && c.share, role)
    assert.equal(c.voidOrOverdue, false, role)
  }
})

test('member y los valores heredados (brand_manager/finance) tienen el mismo acceso que owner a las facturas de su marca', () => {
  const owner = decideInvoiceAccess({ ...base, brand: brand('brand-A', 'owner') })
  for (const role of ['brand_manager', 'member', 'finance'] as Role[]) {
    assert.deepEqual(decideInvoiceAccess({ ...base, brand: brand('brand-A', role) }), owner, role)
  }
})

test('una marca sin relación con la factura no accede, con cualquier rol', () => {
  for (const role of ['owner', 'member'] as Role[]) {
    const c = decideInvoiceAccess({ ...base, brand: brand('brand-B', role) })
    assert.deepEqual({ ...c, actor: undefined }, { ...NONE, actor: undefined }, role)
    assert.equal(c.actor, 'none')
  }
})

test('marca B no accede a la factura de A (aislamiento), aunque tenga billing', () => {
  const c = decideInvoiceAccess({ ...base, brand: brand('brand-B', 'owner') })
  assert.equal(c.actor, 'none')
  assert.equal(c.read, false)
})

test('factura sin propietario (SCENCE o histórica): ninguna marca accede, ni siquiera "owner" de otra', () => {
  for (const role of ['owner', 'finance', 'brand_manager', 'member'] as Role[]) {
    const c = decideInvoiceAccess({ ...base, ownerBrandId: null, brand: brand('brand-A', role) })
    assert.equal(c.actor, 'none', role)
    assert.equal(c.read, false, role)
  }
})

test('acceso compartido activo: SOLO lectura; no edita, no paga, no envía, no borra y NO re-comparte', () => {
  for (const role of ['owner'] as Role[]) {
    const c = decideInvoiceAccess({ ...base, brand: brand('brand-B', role), shareActive: true })
    assert.equal(c.actor, 'shared_brand', role)
    assert.equal(c.read, true)
    assert.deepEqual({ edit: c.edit, send: c.send, markPaid: c.markPaid, voidOrOverdue: c.voidOrOverdue, delete: c.delete, share: c.share },
      { edit: false, send: false, markPaid: false, voidOrOverdue: false, delete: false, share: false })
  }
})

test('acceso compartido: owner y member de la marca destinataria leen; sin acceso compartido no', () => {
  for (const role of ['owner', 'member'] as Role[]) {
    assert.equal(decideInvoiceAccess({ ...base, brand: brand('brand-B', role), shareActive: true }).actor, 'shared_brand', role)
    assert.equal(decideInvoiceAccess({ ...base, brand: brand('brand-B', role), shareActive: false }).actor, 'none', role)
  }
})

test('acceso compartido revocado (shareActive=false) bloquea el acceso', () => {
  assert.equal(decideInvoiceAccess({ ...base, brand: brand('brand-B', 'owner'), shareActive: false }).actor, 'none')
})

test('compartir una factura sin propietario con una marca solo da lectura', () => {
  const c = decideInvoiceAccess({ ...base, ownerBrandId: null, brand: brand('brand-B', 'owner'), shareActive: true })
  assert.equal(c.actor, 'shared_brand')
  assert.equal(c.markPaid, false)
})

test('usuario sin marca ni admin (otra organización / influencer): sin acceso', () => {
  assert.equal(decideInvoiceAccess({ ...base, brand: null, shareActive: true }).actor, 'none')
})

test('redactInvoiceForShare quita propietario, organización, emisor, pasarela y metadata cruda', () => {
  const r = redactInvoiceForShare({ id: 'i', total: 5, organization_id: 'o', issued_by: 'u', stripe_invoice_id: 's', owner_brand_id: 'b', metadata: { kind: 'x' }, client_name: 'C' })
  assert.deepEqual(r, { id: 'i', total: 5, client_name: 'C' })
})

test('isUuid valida el formato', () => {
  assert.equal(isUuid('3f2b1c4e-1111-4222-8333-444455556666'), true)
  assert.equal(isUuid('no-uuid'), false)
  assert.equal(isUuid(null), false)
})
