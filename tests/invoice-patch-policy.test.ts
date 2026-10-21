import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { planInvoicePatch } from '../src/lib/invoice-patch-policy.ts'

const NOW = '2026-10-13T12:00:00.000Z'
const ctx = (over: Partial<Parameters<typeof planInvoicePatch>[1]> = {}) => ({
  isAdmin: true, currentStatus: 'sent', clientEmail: 'cliente@marca.cl', now: NOW, ...over,
})
const bad = (p: ReturnType<typeof planInvoicePatch>) => { assert.equal(p.ok, false); return p as { ok: false; status: number; error: string } }

test('payloads reales de la UI siguen funcionando para admin', () => {
  const paid = planInvoicePatch({ action: 'mark_paid' }, ctx())
  assert.ok(paid.ok && paid.kind === 'action')
  assert.equal(paid.ok && paid.update.status, 'paid')
  assert.equal(paid.ok && paid.update.paid_at, NOW)
  const send = planInvoicePatch({ action: 'send', send_to: 'otro@x.cl', note: 'hola' }, ctx({ currentStatus: 'draft' }))
  assert.ok(send.ok && send.kind === 'action')
  assert.equal(send.ok && send.kind === 'action' && send.sendTo, 'otro@x.cl')
  assert.ok(planInvoicePatch({ action: 'void' }, ctx()).ok)
})

test('una marca NO puede marcar pagada, anular ni vencer una factura', () => {
  for (const action of ['mark_paid', 'void', 'mark_overdue']) {
    assert.equal(bad(planInvoicePatch({ action }, ctx({ isAdmin: false }))).status, 403)
  }
})

test('una marca puede enviar, pero solo al email registrado de la factura', () => {
  const p = planInvoicePatch({ action: 'send', send_to: 'victima@tercero.com' }, ctx({ isAdmin: false, currentStatus: 'draft' }))
  assert.ok(p.ok && p.kind === 'action')
  assert.equal(p.ok && p.kind === 'action' && p.sendTo, 'cliente@marca.cl')
})

test('el PATCH genérico rechaza campos financieros y de ownership (422)', () => {
  for (const field of ['total', 'subtotal', 'tax_amount', 'tax_rate', 'discount_amount', 'currency', 'status', 'paid_at',
    'payment_reference', 'organization_id', 'brand_id', 'campaign_id', 'invoice_number', 'issued_by', 'stripe_invoice_id', 'pdf_url', 'metadata']) {
    const r = bad(planInvoicePatch({ [field]: field === 'metadata' ? { kind: 'x' } : 1 }, ctx()))
    assert.equal(r.status, 422, field)
  }
})

test('acciones no aceptan campos extra (p.ej. mark_paid con total)', () => {
  assert.equal(bad(planInvoicePatch({ action: 'mark_paid', total: 0 }, ctx())).status, 422)
  assert.equal(bad(planInvoicePatch({ action: 'hack' }, ctx())).status, 422)
})

test('edición genérica: solo admin y solo campos no financieros', () => {
  assert.equal(bad(planInvoicePatch({ notes: 'x' }, ctx({ isAdmin: false }))).status, 403)
  const ok = planInvoicePatch({ notes: ' nota ', due_date: '2026-11-01', client_email: 'a@b.cl' }, ctx())
  assert.ok(ok.ok && ok.kind === 'edit')
  if (ok.ok && ok.kind === 'edit') {
    assert.equal(ok.update.notes, 'nota')
    assert.deepEqual(ok.metadataPatch, { client_email: 'a@b.cl' })
    assert.ok(!('status' in ok.update) && !('total' in ok.update))
  }
  assert.equal(bad(planInvoicePatch({ due_date: '01/11/2026' }, ctx())).status, 422)
  assert.equal(bad(planInvoicePatch({ client_email: 'no-es-email' }, ctx())).status, 422)
  assert.equal(bad(planInvoicePatch({}, ctx())).status, 422)
})

test('paid y void son terminales: ninguna acción ni edición (409), tampoco admin', () => {
  for (const currentStatus of ['paid', 'void']) {
    assert.equal(bad(planInvoicePatch({ action: 'mark_paid' }, ctx({ currentStatus }))).status, 409)
    assert.equal(bad(planInvoicePatch({ action: 'send' }, ctx({ currentStatus }))).status, 409)
    assert.equal(bad(planInvoicePatch({ notes: 'x' }, ctx({ currentStatus }))).status, 409)
  }
})

test('issue_date solo se cambia en borrador', () => {
  assert.equal(bad(planInvoicePatch({ issue_date: '2026-10-01' }, ctx({ currentStatus: 'sent' }))).status, 409)
  assert.ok(planInvoicePatch({ issue_date: '2026-10-01' }, ctx({ currentStatus: 'draft' })).ok)
})

const route = readFileSync('src/app/api/invoices/[id]/route.ts', 'utf8')
const patch = route.slice(route.indexOf('export async function PATCH'), route.indexOf('export async function DELETE'))

test('la ruta no pasa el body al UPDATE y re-verifica el estado de forma atómica', () => {
  assert.match(patch, /planInvoicePatch\(body/)
  assert.doesNotMatch(patch, /\.\.\.fields/)
  assert.match(patch, /\.in\('status', MUTABLE_INVOICE_STATUSES/)
  assert.match(patch, /status: 409/)
})

test('la activación de colaboración valida invoice_id y revisa errores', () => {
  assert.match(patch, /\.eq\('invoice_id', params\.id\)/)
  assert.match(patch, /activateErr \|\| linkErr/)
  assert.ok(patch.indexOf('.in(\'status\'') < patch.indexOf('campaign_brand_applications'))
})
