// KPI de facturación — definiciones únicas (auditoría KPI 2026-10-12).
//
//  - FACTURADO: facturas emitidas al cliente (enviada, parcialmente pagada,
//    vencida o pagada). No incluye borradores ni anuladas.
//  - COBRADO: dinero efectivamente recibido = facturas en estado 'paid'.
//    (No existe un monto parcial: `partially_paid` no tiene "monto pagado" en
//    la base, por eso no suma aquí.)
//  - VENCIDO: factura impaga (enviada, parcialmente pagada o marcada vencida)
//    cuya fecha de vencimiento ya pasó, aunque su estado todavía diga 'sent'.
//
// Una factura 'sent' NO es un pago recibido.

export const BILLED_INVOICE_STATUSES = ['sent', 'partially_paid', 'overdue', 'paid'] as const

const UNPAID_INVOICE_STATUSES = ['sent', 'partially_paid', 'overdue']

export type InvoiceKpiRow = {
  status: string
  total: number | string | null
  due_date?: string | null
}

/** Fecha de hoy (YYYY-MM-DD) en la zona horaria de Chile. */
export function todayInChile(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(now)
}

export function isInvoiceBilled(invoice: Pick<InvoiceKpiRow, 'status'>): boolean {
  return (BILLED_INVOICE_STATUSES as readonly string[]).includes(invoice.status)
}

export function isInvoiceOverdue(invoice: InvoiceKpiRow, today: string = todayInChile()): boolean {
  if (invoice.status === 'overdue') return true
  if (!UNPAID_INVOICE_STATUSES.includes(invoice.status)) return false
  return Boolean(invoice.due_date) && String(invoice.due_date).slice(0, 10) < today
}

export function summarizeInvoices(invoices: InvoiceKpiRow[], today: string = todayInChile()) {
  let billed = 0
  let collected = 0
  let overdue = 0
  let overdueCount = 0
  for (const invoice of invoices) {
    const total = Number(invoice.total ?? 0)
    if (isInvoiceBilled(invoice)) billed += total
    if (invoice.status === 'paid') collected += total
    if (isInvoiceOverdue(invoice, today)) {
      overdue += total
      overdueCount += 1
    }
  }
  return { billed, collected, overdue, overdueCount }
}
