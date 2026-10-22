import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'

register('./support/ts-resolve.mjs', import.meta.url)
const { planInvoicePatch } = await import('../src/lib/invoice-patch-policy.ts')
const { decideInvoiceAccess } = await import('../src/lib/invoice-access.ts')

const NOW = '2026-10-13T12:00:00.000Z'
type Actor = 'admin' | 'owner' | 'owner-readonly' | 'shared' | 'none'
const capsOf = (actor: Actor) => decideInvoiceAccess({
  isPlatformAdmin: actor === 'admin',
  brand: actor === 'none' ? null : { brandId: 'brand-A', role: actor === 'owner-readonly' ? 'member' : 'finance' },
  ownerBrandId: actor === 'shared' ? 'brand-B' : 'brand-A',
  shareActive: actor === 'shared',
})
const ctx = (actor: Actor = 'admin', over: Record<string, unknown> = {}) => ({
  caps: capsOf(actor), currentStatus: 'sent', clientEmail: 'cliente@marca.cl', now: NOW, ...over,
}) as Parameters<typeof planInvoicePatch>[1]
const bad = (p: ReturnType<typeof planInvoicePatch>) => { assert.equal(p.ok, false); return p as { ok: false; status: number; error: string } }

test('payloads reales de la UI siguen funcionando para admin', () => {
  const paid = planInvoicePatch({ action: 'mark_paid' }, ctx())
  assert.ok(paid.ok && paid.kind === 'action')
  assert.equal(paid.ok && paid.update.status, 'paid')
  assert.equal(paid.ok && paid.update.paid_at, NOW)
  const send = planInvoicePatch({ action: 'send', send_to: 'otro@x.cl', note: 'hola' }, ctx('admin', { currentStatus: 'draft' }))
  assert.ok(send.ok && send.kind === 'action')
  assert.equal(send.ok && send.kind === 'action' && send.sendTo, 'otro@x.cl')
  assert.ok(planInvoicePatch({ action: 'void' }, ctx()).ok)
})

test('la marca PROPIETARIA puede marcar pagada su factura con paid_at y referencia', () => {
  const p = planInvoicePatch({ action: 'mark_paid', payment_reference: '  TRX-123 ' }, ctx('owner'))
  assert.ok(p.ok && p.kind === 'action')
  if (p.ok && p.kind === 'action') {
    assert.equal(p.update.status, 'paid')
    assert.equal(p.update.paid_at, NOW)
    assert.equal(p.update.payment_reference, 'TRX-123')
  }
  assert.equal(bad(planInvoicePatch({ action: 'mark_paid', payment_reference: 'x'.repeat(201) }, ctx('owner'))).status, 422)
})

test('void y mark_overdue siguen siendo EXCLUSIVOS de SCENCE (también para la marca propietaria)', () => {
  for (const action of ['void', 'mark_overdue']) {
    assert.equal(bad(planInvoicePatch({ action }, ctx('owner'))).status, 403, action)
    assert.ok(planInvoicePatch({ action }, ctx('admin')).ok, action)
  }
})

test('una marca propietaria SIN permiso de facturación no puede pagar, enviar ni editar (403)', () => {
  // role=member tiene lectura de marca pero no billing.*; no ve la factura → 404 (no revela existencia)
  assert.equal(bad(planInvoicePatch({ action: 'mark_paid' }, ctx('owner-readonly'))).status, 404)
})

test('marca con acceso compartido: SOLO lectura, ninguna acción ni edición (403)', () => {
  for (const body of [{ action: 'mark_paid' }, { action: 'send' }, { action: 'void' }, { action: 'mark_overdue' }, { notes: 'x' }]) {
    assert.equal(bad(planInvoicePatch(body, ctx('shared'))).status, 403, JSON.stringify(body))
  }
})

test('sin acceso a la factura: 404, sin revelar estado (ni siquiera 409 en facturas pagadas)', () => {
  assert.equal(bad(planInvoicePatch({ action: 'mark_paid' }, ctx('none'))).status, 404)
  assert.equal(bad(planInvoicePatch({ action: 'mark_paid' }, ctx('none', { currentStatus: 'paid' }))).status, 404)
})

test('una marca puede enviar, pero solo al email registrado de la factura', () => {
  const p = planInvoicePatch({ action: 'send', send_to: 'victima@tercero.com' }, ctx('owner', { currentStatus: 'draft' }))
  assert.ok(p.ok && p.kind === 'action')
  assert.equal(p.ok && p.kind === 'action' && p.sendTo, 'cliente@marca.cl')
})

test('el PATCH genérico rechaza campos financieros y de propiedad (422), también a la marca propietaria', () => {
  for (const actor of ['admin', 'owner'] as Actor[]) {
    for (const field of ['total', 'subtotal', 'tax_amount', 'tax_rate', 'discount_amount', 'currency', 'status', 'paid_at',
      'payment_reference', 'organization_id', 'brand_id', 'owner_brand_id', 'campaign_id', 'invoice_number', 'issued_by', 'stripe_invoice_id', 'pdf_url', 'metadata']) {
      const r = bad(planInvoicePatch({ [field]: field === 'metadata' ? { kind: 'x' } : 1 }, ctx(actor)))
      assert.equal(r.status, 422, `${actor}:${field}`)
    }
  }
})

test('acciones no aceptan campos extra (p.ej. mark_paid con total u owner_brand_id)', () => {
  assert.equal(bad(planInvoicePatch({ action: 'mark_paid', total: 0 }, ctx())).status, 422)
  assert.equal(bad(planInvoicePatch({ action: 'mark_paid', owner_brand_id: 'brand-B' }, ctx('owner'))).status, 422)
  assert.equal(bad(planInvoicePatch({ action: 'hack' }, ctx())).status, 422)
})

test('edición genérica: admin y marca propietaria (campos no financieros); compartida y sin acceso no', () => {
  const ok = planInvoicePatch({ notes: ' nota ', due_date: '2026-11-01', client_email: 'a@b.cl' }, ctx())
  assert.ok(ok.ok && ok.kind === 'edit')
  if (ok.ok && ok.kind === 'edit') {
    assert.equal(ok.update.notes, 'nota')
    assert.deepEqual(ok.metadataPatch, { client_email: 'a@b.cl' })
    assert.ok(!('status' in ok.update) && !('total' in ok.update))
  }
  assert.ok(planInvoicePatch({ notes: 'x' }, ctx('owner')).ok)
  assert.equal(bad(planInvoicePatch({ due_date: '01/11/2026' }, ctx())).status, 422)
  assert.equal(bad(planInvoicePatch({ client_email: 'no-es-email' }, ctx())).status, 422)
  assert.equal(bad(planInvoicePatch({}, ctx())).status, 422)
})

test('paid y void son terminales: ninguna acción ni edición (409), tampoco admin ni la marca propietaria', () => {
  for (const actor of ['admin', 'owner'] as Actor[]) {
    for (const currentStatus of ['paid', 'void']) {
      assert.equal(bad(planInvoicePatch({ action: 'mark_paid' }, ctx(actor, { currentStatus }))).status, 409)
      assert.equal(bad(planInvoicePatch({ action: 'send' }, ctx(actor, { currentStatus }))).status, 409)
      assert.equal(bad(planInvoicePatch({ notes: 'x' }, ctx(actor, { currentStatus }))).status, 409)
    }
  }
})

test('issue_date solo se cambia en borrador', () => {
  assert.equal(bad(planInvoicePatch({ issue_date: '2026-10-01' }, ctx('admin', { currentStatus: 'sent' }))).status, 409)
  assert.ok(planInvoicePatch({ issue_date: '2026-10-01' }, ctx('admin', { currentStatus: 'draft' })).ok)
})

const route = readFileSync('src/app/api/invoices/[id]/route.ts', 'utf8')
const patch = route.slice(route.indexOf('export async function PATCH'), route.indexOf('export async function DELETE'))

test('la ruta no pasa el body al UPDATE y re-verifica el estado de forma atómica', () => {
  assert.match(patch, /planInvoicePatch\(body/)
  assert.doesNotMatch(patch, /\.\.\.fields/)
  assert.match(patch, /\.in\('status', MUTABLE_INVOICE_STATUSES/)
  assert.match(patch, /status: 409/)
})

test('la activación de colaboración valida invoice_id, revisa errores y solo la confirma SCENCE', () => {
  assert.match(patch, /\.eq\('invoice_id', params\.id\)/)
  assert.match(patch, /activateErr \|\| linkErr/)
  assert.match(patch, /caps\.actor === 'platform_admin' && invoiceMeta\.kind === 'campaign_brand_collaboration'/)
  assert.ok(patch.indexOf('.in(\'status\'') < patch.indexOf('campaign_brand_applications'))
})
