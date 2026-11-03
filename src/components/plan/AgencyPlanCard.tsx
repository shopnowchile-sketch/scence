'use client'

/**
 * AgencyPlanCard — mensualidad PayPal de UNA marca administrada por una agencia (Impulso Consulting).
 * Muestra el monto exacto en USD que PayPal cobrará (leído del plan en PayPal por el servidor) antes de confirmar.
 * Reutiliza /api/paypal/checkout y /api/paypal/complete; el pago no aprueba ni publica ninguna campaña.
 */

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { formatPriceCLP } from '@/lib/plan-limits'

type PlanInfo = { amount_usd: string; currency: string; price_clp: number; commitment_months: number; already_current: boolean }

export function AgencyPlanCard({ brandId, campaignId, brandName, onCancel }: {
  brandId: string
  campaignId?: string
  brandName?: string | null
  onCancel?: () => void
}) {
  const [info, setInfo] = useState<PlanInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [paying, setPaying] = useState(false)

  useEffect(() => {
    let active = true
    setInfo(null); setError(null)
    fetch(`/api/paypal/checkout?tier=agency&brand_id=${encodeURIComponent(brandId)}`, { cache: 'no-store' })
      .then(async res => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'No se pudo leer el monto')
        if (active) setInfo(json)
      })
      .catch(e => { if (active) setError((e as Error).message) })
    return () => { active = false }
  }, [brandId])

  async function pay() {
    setPaying(true)
    try {
      const res = await fetch('/api/paypal/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: 'agency', brand_id: brandId, campaign_id: campaignId }),
      })
      const json = await res.json()
      if (res.ok && json.url) { window.location.href = json.url; return }
      toast.error(json.error ?? 'No se pudo iniciar PayPal')
    } catch (e) {
      toast.error((e as Error).message ?? 'No se pudo conectar con PayPal')
    } finally {
      setPaying(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-bold text-gray-900">Activación de campañas SCENCE</h3>
        {brandName && <p className="text-xs text-gray-400 mt-0.5">Marca: {brandName}</p>}
      </div>
      <p className="text-sm text-gray-600">
        Para activar tu servicio, debes contratar un plan de {info?.commitment_months ?? 3} meses mediante PayPal.
      </p>
      <p className="text-sm text-gray-600">
        {formatPriceCLP(info?.price_clp ?? 69900)} CLP mensuales durante {info?.commitment_months ?? 3} meses, cobrados en USD según la conversión correspondiente.
      </p>
      {info && (
        <div className="rounded-xl bg-violet-50 border border-violet-100 px-4 py-3">
          <p className="text-xs text-violet-700">Monto exacto que PayPal cobrará cada mes</p>
          <p className="text-2xl font-bold text-violet-900">{info.currency} {info.amount_usd}</p>
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <p className="text-xs text-gray-400">Cada marca tiene su propia suscripción. Tu campaña pasa a revisión de SCENCE; el pago no la publica automáticamente.</p>
      <div className="flex gap-2">
        {onCancel && <button onClick={onCancel} className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">Ahora no</button>}
        <button onClick={pay} disabled={paying || !info || info.already_current}
          className="px-4 py-2 text-sm rounded-lg bg-violet-600 text-white font-semibold hover:bg-violet-700 disabled:opacity-50">
          {info?.already_current ? 'Mensualidad vigente' : paying ? 'Abriendo PayPal…' : 'Pagar con PayPal'}
        </button>
      </div>
    </div>
  )
}
