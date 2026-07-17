'use client'

/**
 * BrandPlanSettings — UI de suscripción SaaS de marca.
 * Usado en /brand-settings/plan.
 * No es billing operativo ni payroll.
 */

import { useEffect, useState, useCallback } from 'react'
import { Check, RefreshCw, Sparkles, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { PLAN_LIMITS, getPlanTier, formatPriceCLP, type PlanTier } from '@/lib/plan-limits'

const PLAN_DEFS: Array<{
  tier: PlanTier
  highlight?: boolean
  features: string[]
}> = [
  {
    tier: 'basic',
    features: [
      'Campañas privadas ilimitadas',
      'Primera campaña pública incluida',
      'Contenido ilimitado',
      'Hasta 5 creadoras activas',
      'Programa de afiliados / códigos',
      '1 marca incluida',
      'Hasta 5 usuarios',
      'Reportería básica de campañas',
    ],
  },
  {
    tier: 'growth',
    highlight: true,
    features: [
      'Campañas privadas ilimitadas',
      'Primera campaña pública incluida',
      'Contenido ilimitado',
      'Hasta 50 creadoras activas',
      'Programa de afiliados / códigos',
      'Hasta 3 marcas incluidas',
      'Hasta 10 usuarios',
      'Reportería avanzada de campañas',
      'Soporte preferente',
    ],
  },
  {
    tier: 'pro',
    features: [
      'Acceso ilimitado a todo',
      'Campañas privadas ilimitadas',
      'Campañas públicas ilimitadas',
      'Marketplace abierto',
      'Postulaciones abiertas de creadoras',
      'Contenido ilimitado',
      'Creadoras ilimitadas',
      'Marcas ilimitadas',
      'Usuarios ilimitados',
      'Programa de afiliados / códigos',
      'Reportería completa',
      'Soporte prioritario',
    ],
  },
]

export function BrandPlanSettings() {
  const [orgPlan, setOrgPlan] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [checkoutLoading, setCheckoutLoading] = useState<PlanTier | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch('/api/brand/billing')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setOrgPlan(json.org_plan ?? '')
    } catch (e) {
      toast.error((e as Error).message ?? 'Error cargando plan')
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const currentTier = getPlanTier(orgPlan)
  const currentInfo = PLAN_LIMITS[currentTier]
  const isFree = orgPlan === 'free'
  const hasCurrentPlan = isFree || Boolean(orgPlan)

  async function activatePlan(tier: PlanTier) {
    setCheckoutLoading(tier)
    try {
      const res = await fetch('/api/mercadopago/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier }),
      })

      const json = await res.json()

      if (res.ok && json.url) {
        window.location.href = json.url
        return
      }

      toast.error(json.error ?? 'No se pudo iniciar Mercado Pago')
    } catch {
      toast.error('No se pudo conectar con Mercado Pago')
    } finally {
      setCheckoutLoading(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="w-8 h-8 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Suscripción a SCENCE</h2>
          <p className="text-sm text-gray-400 mt-0.5">Elige el plan que mejor se adapta a tu marca</p>
        </div>
        <button onClick={load} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {/* Plan actual */}
      <div className="bg-violet-50 border border-violet-100 rounded-2xl p-4 flex items-center gap-3">
        <Sparkles className="h-5 w-5 text-violet-500 flex-shrink-0" />
        <p className="text-sm text-violet-700">
          Tu plan actual: <span className="font-bold">{isFree ? 'Free' : hasCurrentPlan ? currentInfo.label : 'Sin plan activo'}</span>
          {' · '}
          {!hasCurrentPlan
            ? 'Elige un plan para habilitar el portal de tu marca'
            : isFree
            ? 'Acceso de cortesía asignado por SCENCE'
            : currentTier === 'basic'
            ? 'Acceso básico a SCENCE'
            : currentTier === 'growth'
              ? 'Más creadoras, marcas y reportería'
              : 'Acceso ilimitado a todo'}
        </p>
      </div>

      {/* Cards de planes */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {PLAN_DEFS.map(({ tier, highlight, features }) => {
          const info       = PLAN_LIMITS[tier]
          const isCurrent  = !isFree && hasCurrentPlan && tier === currentTier
          const regular    = info.price_monthly_clp

          return (
            <div
              key={tier}
              className={cn(
                'bg-white rounded-2xl border p-5 flex flex-col',
                isCurrent
                  ? 'border-violet-400 ring-1 ring-violet-200'
                  : highlight
                    ? 'border-violet-200'
                    : 'border-gray-100',
              )}
            >
              {/* Badges */}
              <div className="flex items-center gap-2 mb-3 min-h-[24px]">
                {isCurrent && (
                  <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-violet-100 text-violet-700">
                    Tu plan actual
                  </span>
                )}
                {highlight && !isCurrent && (
                  <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-violet-600 text-white">
                    Más popular
                  </span>
                )}
              </div>

              {/* Nombre */}
              <h3 className="text-base font-bold text-gray-900">{info.label}</h3>

              {/* Precio */}
              <div className="mt-3 mb-1">
                <div className="flex items-end gap-1.5">
                  <span className="text-xl font-bold text-gray-900">
                    {formatPriceCLP(regular)}
                  </span>
                  <span className="text-xs text-gray-400 mb-0.5">CLP/mes</span>
                </div>
                <p className="text-xs text-violet-600 font-semibold mt-1">Cobro mensual automático y seguro</p>
              </div>

              {/* Features */}
              <ul className="space-y-1.5 mt-4 mb-5 flex-1">
                {features.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-gray-600">
                    <Check className="h-3.5 w-3.5 text-violet-500 flex-shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>

              {/* CTA */}
              {isCurrent ? (
                <button
                  disabled
                  className="text-sm font-semibold px-4 py-2 rounded-xl bg-gray-100 text-gray-400 cursor-not-allowed"
                >
                  Plan activo
                </button>
              ) : (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => activatePlan(tier)}
                    disabled={checkoutLoading === tier}
                    className={cn(
                      'w-full flex items-center justify-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl transition-colors disabled:opacity-60',
                      highlight
                        ? 'bg-violet-600 text-white hover:bg-violet-700'
                        : 'border border-gray-200 text-gray-700 hover:bg-gray-50',
                    )}
                  >
                    {checkoutLoading === tier ? 'Abriendo Mercado Pago…' : 'Elegir y pagar'}
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Nota método de pago */}
      <p className="text-xs text-gray-400 text-center pb-4">
        El cobro se procesa mensualmente mediante Mercado Pago. El plan Free solo puede ser asignado por SCENCE.
      </p>
    </div>
  )
}
