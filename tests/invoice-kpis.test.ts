// KPI de facturación: facturado ≠ cobrado ≠ vencido (auditoría KPI 2026-10-12).
// Los casos replican las facturas reales de producción a esa fecha.
import test from 'node:test'
import assert from 'node:assert/strict'
import { isInvoiceOverdue, summarizeInvoices, todayInChile } from '../src/lib/invoice-kpis.ts'

const TODAY = '2026-10-12'
const invoices = [
  { status: 'paid', total: 100000.46, due_date: '2026-07-18' },
  { status: 'paid', total: 249999.96, due_date: '2026-07-18' },
  { status: 'sent', total: 119000, due_date: '2026-08-05' },
  { status: 'sent', total: 595, due_date: '2026-10-08' },
  { status: 'sent', total: 0, due_date: '2026-09-10' },
  { status: 'void', total: 59500, due_date: '2026-09-11' },
  { status: 'draft', total: 0, due_date: '2026-09-08' },
  { status: 'draft', total: 0, due_date: '2026-09-07' },
]

test('facturado = emitidas (sin borradores ni anuladas); cobrado = solo pagadas', () => {
  const { billed, collected } = summarizeInvoices(invoices, TODAY)
  assert.equal(Math.round(billed * 100) / 100, 469595.42)
  assert.equal(Math.round(collected * 100) / 100, 350000.42)
})

test('una factura enviada NO es un pago recibido', () => {
  const sentOnly = summarizeInvoices([{ status: 'sent', total: 1000, due_date: '2026-12-01' }], TODAY)
  assert.equal(sentOnly.billed, 1000)
  assert.equal(sentOnly.collected, 0)
})

test('vencida = impaga con fecha de vencimiento pasada, aunque el estado siga en "sent"', () => {
  const { overdue, overdueCount } = summarizeInvoices(invoices, TODAY)
  assert.equal(overdue, 119595)
  assert.equal(overdueCount, 3)
  assert.equal(isInvoiceOverdue({ status: 'sent', total: 1, due_date: '2026-10-11' }, TODAY), true)
})

test('el día del vencimiento todavía no está vencida; pagada, anulada y borrador nunca lo están', () => {
  assert.equal(isInvoiceOverdue({ status: 'sent', total: 1, due_date: TODAY }, TODAY), false)
  assert.equal(isInvoiceOverdue({ status: 'paid', total: 1, due_date: '2020-01-01' }, TODAY), false)
  assert.equal(isInvoiceOverdue({ status: 'void', total: 1, due_date: '2020-01-01' }, TODAY), false)
  assert.equal(isInvoiceOverdue({ status: 'draft', total: 1, due_date: '2020-01-01' }, TODAY), false)
})

test('estado "overdue" explícito siempre cuenta como vencida', () => {
  assert.equal(isInvoiceOverdue({ status: 'overdue', total: 1, due_date: '2099-01-01' }, TODAY), true)
})

test('todayInChile devuelve YYYY-MM-DD', () => {
  assert.match(todayInChile(new Date('2026-10-13T01:00:00Z')), /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(todayInChile(new Date('2026-10-13T01:00:00Z')), '2026-10-12')
})
