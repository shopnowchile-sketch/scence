import test from 'node:test'
import assert from 'node:assert/strict'
import { generateSubscriptionReceiptPdf } from '../src/lib/subscription-receipt-pdf'

test('SCENCE Pro receipt preserves the recorded amount and currency', () => {
  const pdf = generateSubscriptionReceiptPdf({
    influencerName: 'Influencer Test',
    influencerEmail: 'test@example.com',
    paymentDate: '2026-09-20T13:30:55Z',
    periodStart: null,
    periodEnd: null,
    amount: '8.60',
    currency: 'USD',
    gateway: 'paypal',
    gatewayPaymentId: '6DB157598L534553F',
    status: 'completed',
    receiptUrl: 'https://api.paypal.com/v1/payments/sale/6DB157598L534553F',
  })

  assert.ok(pdf.byteLength > 1000)
  const text = new TextDecoder().decode(pdf)
  assert.match(text, /8\.60/)
  assert.match(text, /USD/)
  assert.match(text, /6DB157598L534553F/)
  assert.doesNotMatch(text, /descuento/i)
  assert.doesNotMatch(text, /precio original/i)
})
