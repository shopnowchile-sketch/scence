'use client'

import { useEffect, useState } from 'react'
import { Gift, AlertTriangle, Check, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { type Barter, type BarterSimpleStatus } from '@/types'

/**
 * Vista de solo lectura de canjes. Reutilizable en portal marca e influencer.
 * Carga desde un endpoint scoped por ownership (no expone canjes de terceros).
 */
export function BartersReadonly({ endpoint }: { endpoint: string }) {
  const [barters, setBarters] = useState<Barter[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const res = await fetch(endpoint)
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(json.error ?? 'No se pudieron cargar tus canjes')
        if (active) setBarters(json.data ?? [])
      } catch (err) {
        if (active) {
          setBarters([])
          setError(err instanceof Error ? err.message : 'No se pudieron cargar tus canjes')
        }
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [endpoint])

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <div className="flex items-center gap-2 text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin" /> <span className="text-sm">Cargando canjes…</span>
        </div>
      </div>
    )
  }

  if (error) return (
    <div className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">
      No pudimos cargar tu canje: {error}
    </div>
  )

  if (barters.length === 0) return (
    <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm text-amber-800">
      Tu beneficio aún está siendo preparado. Si ya fuiste aceptada, actualiza la página en unos minutos.
    </div>
  )

  const isReferralMission = barters.some(b => (b.campaign_benefits ?? []).some(x => x.benefit_type === 'sales_commission'))

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-gray-700 flex items-center gap-2">
          <Gift className="h-4 w-4 text-violet-500" /> {isReferralMission ? 'Tu misión y comisión' : `Canjes (${barters.length})`}
        </h2>
      </div>

      <div className="space-y-3">
        {barters.map(b => <ReadonlyBarterCard key={b.id} barter={b} />)}
      </div>
    </div>
  )
}

function ReadonlyBarterCard({ barter: b }: { barter: Barter }) {
  const benefits = b.campaign_benefits?.length ? b.campaign_benefits : (b.benefits ?? []).map(benefit => ({
    benefit_type: benefit.benefit_type,
    description: benefit.description ?? b.item,
    quantity: 1,
    commission_rate: benefit.commission_rate,
  }))

  return (
    <div className="divide-y divide-gray-100 rounded-xl border border-gray-100 px-3">
      {benefits.map((benefit, index) => {
        const tracking = b.benefit_tracking?.find(row => row.benefit_index === index)
        const status: BarterSimpleStatus = tracking?.status ?? b.simple_status ?? 'pending'
        const isCommission = benefit.benefit_type === 'sales_commission'
        return (
          <div key={`${benefit.benefit_type}-${index}`} className="flex items-start gap-3 py-3">
            <StatusIcon status={status} />
            <div className="min-w-0 flex-1">
              {isCommission ? <>
                <p className="text-sm font-bold text-gray-900">Comisión por venta{benefit.commission_rate ? ` · ${benefit.commission_rate}%` : ''}</p>
                <p className="text-xs text-gray-500 mt-1">Invita a una marca a registrarse en SCENCE usando tu usuario. Cuando se registre, verás aquí la marca vinculada y el estado de tu comisión.</p>
                {status === 'pending' && <div className="grid grid-cols-3 gap-1 mt-3 text-[10px] font-medium text-gray-500"><span>1. Comparte</span><span>2. Se registra</span><span>3. Comisión</span></div>}
              </> : <p className="text-sm font-semibold text-gray-900">{benefit.quantity}× {benefit.description}</p>}
              <p className={cn('mt-2 text-xs font-semibold', status === 'completed' ? 'text-emerald-600' : status === 'problem' ? 'text-red-600' : 'text-amber-600')}>
                {status === 'completed' ? (isCommission ? 'Marca vinculada' : 'Canje enviado') : status === 'problem' ? 'Con problema' : isCommission ? 'Esperando registro de marca' : 'Pendiente'}
              </p>
              {tracking?.note && <p className="mt-1 text-xs text-gray-500">{tracking.note}</p>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function StatusIcon({ status }: { status: BarterSimpleStatus }) {
  if (status === 'completed') return <span className="mt-0.5 rounded-full bg-emerald-50 p-1"><Check className="h-3.5 w-3.5 text-emerald-600" /></span>
  if (status === 'problem') return <span className="mt-0.5 rounded-full bg-red-50 p-1"><AlertTriangle className="h-3.5 w-3.5 text-red-600" /></span>
  return <span className="mt-0.5 h-5 w-5 rounded-full border-2 border-amber-300" />
}
