import { jsPDF } from 'jspdf'

export type SubscriptionReceiptPdfData = {
  influencerName: string
  influencerEmail?: string | null
  paymentDate: string
  periodStart?: string | null
  periodEnd?: string | null
  amount: number | string
  currency: string
  gateway: string
  gatewayPaymentId?: string | null
  status: string
  concept?: string | null
  receiptUrl?: string | null
  termsAcceptedAt?: string | null
}

function money(amount: number, currency: string) {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency,
    minimumFractionDigits: undefined,
    maximumFractionDigits: 20,
  }).format(amount)
}

function date(value?: string | null) {
  if (!value) return 'No informado'
  return new Intl.DateTimeFormat('es-CL', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Santiago',
  }).format(new Date(value))
}

export function generateSubscriptionReceiptPdf(data: SubscriptionReceiptPdfData): ArrayBuffer {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const amount = Number(data.amount)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.text('SCENCE', 20, 24)

  doc.setFontSize(12)
  doc.setFont('helvetica', 'normal')
  doc.text('Comprobante de suscripción Pro', 20, 32)

  doc.setDrawColor(225, 225, 225)
  doc.line(20, 38, 190, 38)

  let y = 50
  const row = (label: string, value: string) => {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.text(label, 20, y)
    doc.setFont('helvetica', 'normal')
    doc.text(value, 75, y)
    y += 9
  }

  row('Influencer', data.influencerName)
  if (data.influencerEmail) row('Email', data.influencerEmail)
  row('Fecha de pago', date(data.paymentDate))
  row('Período desde', date(data.periodStart))
  row('Período hasta', date(data.periodEnd))
  row('Monto cobrado', Number.isFinite(amount) ? money(amount, data.currency) : String(data.amount))
  row('Moneda', data.currency)
  row('Gateway', data.gateway)
  row('ID de transacción', data.gatewayPaymentId ?? 'No informado')
  row('Estado', data.status)
  if (data.concept) row('Concepto', data.concept)

  if (data.termsAcceptedAt) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(55, 55, 55)
    doc.text(`Términos y Condiciones aceptados por ${data.influencerName} el ${date(data.termsAcceptedAt)}.`, 20, y)
    y += 10
  }

  if (data.receiptUrl) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.text('Comprobante del gateway', 20, y)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(109, 40, 217)
    doc.textWithLink('Ver en gateway', 75, y, { url: data.receiptUrl })
    doc.setTextColor(0, 0, 0)
    y += 12
  }

  y += 8
  doc.setDrawColor(225, 225, 225)
  doc.line(20, y, 190, y)
  y += 10

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(110, 110, 110)
  doc.text('Este documento es un comprobante de pago de la suscripción SCENCE Pro.', 20, y)
  doc.text('No constituye una boleta o factura tributaria.', 20, y + 5)

  return doc.output('arraybuffer')
}
