'use client'

import { useEffect, useState } from 'react'
import { AgencyPlanCard } from './AgencyPlanCard'

export const AGENCY_PAYMENT_REQUIRED_EVENT = 'scence:agency-payment-required'

/** Avisa al portal que enviar a aprobación necesita la mensualidad de esa marca (respuesta 402 del servidor). */
export function notifyAgencyPaymentRequired(detail: { brandId: string; campaignId?: string }) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(AGENCY_PAYMENT_REQUIRED_EVENT, { detail }))
}

/** Modal global del portal de marca: se abre con el 402 y ofrece el checkout PayPal de la marca. */
export function AgencyCheckoutGate() {
  const [request, setRequest] = useState<{ brandId: string; campaignId?: string } | null>(null)
  useEffect(() => {
    const open = (event: Event) => setRequest((event as CustomEvent<{ brandId: string; campaignId?: string }>).detail)
    window.addEventListener(AGENCY_PAYMENT_REQUIRED_EVENT, open)
    return () => window.removeEventListener(AGENCY_PAYMENT_REQUIRED_EVENT, open)
  }, [])
  if (!request) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <AgencyPlanCard brandId={request.brandId} campaignId={request.campaignId} onCancel={() => setRequest(null)} />
      </div>
    </div>
  )
}
