'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AgencyPlanCard } from './AgencyPlanCard'

export const AGENCY_PAYMENT_REQUIRED_EVENT = 'scence:agency-payment-required'

// checkout = lo que el servidor indicó en el 402: 'agency' (mensualidad de una marca de agencia) o 'plan'
// (pyme o marca independiente: elige su plan SCORE). Sin dato se asume 'agency', como antes.
type PaymentRequest = { brandId: string; campaignId?: string; checkout?: 'agency' | 'plan' }

/** Avisa al portal que enviar a aprobación necesita el plan vigente de esa marca (respuesta 402 del servidor). */
export function notifyAgencyPaymentRequired(detail: PaymentRequest) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(AGENCY_PAYMENT_REQUIRED_EVENT, { detail }))
}

/** Modal global del portal de marca: se abre con el 402 y lleva al pago que corresponde a esa marca. */
export function AgencyCheckoutGate() {
  const [request, setRequest] = useState<PaymentRequest | null>(null)
  useEffect(() => {
    const open = (event: Event) => setRequest((event as CustomEvent<PaymentRequest>).detail)
    window.addEventListener(AGENCY_PAYMENT_REQUIRED_EVENT, open)
    return () => window.removeEventListener(AGENCY_PAYMENT_REQUIRED_EVENT, open)
  }, [])
  if (!request) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        {request.checkout === 'plan' ? (
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-gray-900">Elige tu plan para enviar la campaña</h3>
            <p className="text-sm text-gray-600">
              Tu campaña quedó guardada como borrador. Para enviarla a aprobación necesitas un plan SCENCE vigente.
              Después del pago firmas el NDA y SCENCE revisa la campaña antes de publicarla.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setRequest(null)} className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">Ahora no</button>
              <Link
                href={`/brand-settings/plan${request.campaignId ? `?campaign=${encodeURIComponent(request.campaignId)}` : ''}`}
                onClick={() => setRequest(null)}
                className="px-4 py-2 text-sm rounded-lg bg-violet-600 text-white font-semibold hover:bg-violet-700"
              >
                Ver planes
              </Link>
            </div>
          </div>
        ) : (
          <AgencyPlanCard brandId={request.brandId} campaignId={request.campaignId} onCancel={() => setRequest(null)} />
        )}
      </div>
    </div>
  )
}
