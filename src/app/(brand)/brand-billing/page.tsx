'use client'

import { useEffect, useState, useCallback } from 'react'
import { Check, RefreshCw, Sparkles, Clock, ArrowRight, BadgeCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { PLAN_LIMITS, getPlanTier, formatPriceCLP, type PlanTier } from '@/lib/plan-limits'

// ── Definición visual de planes (precio desde PLAN_LIMITS, features propios) ──

const PLAN_DEFS: Array<{
  tier: PlanTier
  highlight?: boolean
  features: string[]
}> = [
  {
    tier: 'basic',
    features: [
      '1 campaña activa',
      'Hasta 3 influencers en roster',
      'Campañas privadas',
      'Invitaciones directas',
      'Reportería básica',
    ],
  },
  {
    tier: 'growth',
    highlight: true,
    features: [
      'Hasta 5 campañas activas',
      'Hasta 25 influencers en roster',
      'Campañas privadas',
      'Invitaciones directas',
      'Matchmaker con IA',
      'Hasta 5 usuarios',
      'Reportería avanzada',
    ],
  },
  {
    tier: 'pro',
    features: [
      'Campañas ilimitadas',
      'Influencers ilimitados',
      'Campañas abiertas + marketplace',
      'Postulaciones de creadores',
      'Matchmaker con IA',
      'Hasta 10 usuarios',
      'Reportería completa',
      'Soporte prioritario',
    ],
  },
]

function discountedPrice(amount: number) {
  return Math.round(amount * 0.8)
}

export default function BrandBillingPage() {
  const [orgPlan, setOrgPlan] = useState<string>('free')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch('/api/brand/billing')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setOrgPlan(json.org_plan ?? 'free')
    } catch (e) {
      toast.error((e as Error).message ?? 'Error cargando plan')
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const currentTier = getPlanTier(orgPlan)
  const currentInfo = PLAN_LIMITS[currentTier]

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-10 h-10 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-4xl">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Suscripción</h1>
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
          Tu plan actual: <span className="font-bold">{currentInfo.label}</span>
          {' · '}
          {currentTier === 'basic'
            ? 'Acceso básico a SCENCE'
            : currentTier === 'growth'
              ? 'Múltiples campañas y creadores'
              : 'Acceso completo, sin límites'}
        </p>
      </div>

      {/* Banner: pagos no activados */}
      <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 flex items-start gap-3">
        <Clock className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-amber-800">Pagos aún no activados</p>
          <p className="text-xs text-amber-700 mt-0.5">
            Los cobros automáticos están en proceso de integración. Para cambiar de plan contáctanos y lo activamos manualmente en minutos.
          </p>
        </div>
      </div>

      {/* Oferta comercial */}
      <div className="bg-gradient-to-r from-violet-600 to-violet-500 rounded-2xl px-6 py-5 text-white">
        <div className="flex items-center gap-2 mb-2">
          <BadgeCheck className="h-5 w-5 text-violet-200" />
          <span className="text-xs font-bold text-violet-100 uppercase tracking-wide">Oferta de lanzamiento</span>
        </div>
        <p className="text-lg font-bold mb-1">Primer mes gratis</p>
        <p className="text-sm text-violet-200">
          Luego, 3 meses con <strong className="text-white">20% de descuento</strong>. Sin compromiso de permanencia.
        </p>
        <div className="mt-4 flex flex-wrap gap-3 text-xs font-semibold">
          <span className="bg-white/20 rounded-full px-3 py-1">Mes 1: Gratis</span>
          <span className="bg-white/20 rounded-full px-3 py-1">Meses 2–4: −20%</span>
          <span className="bg-white/20 rounded-full px-3 py-1">Mes 5+: precio regular</span>
        </div>
      </div>

      {/* Cards de planes */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {PLAN_DEFS.map(({ tier, highlight, features }) => {
          const info       = PLAN_LIMITS[tier]
          const isCurrent  = tier === currentTier
          const regular    = info.price_monthly_clp
          const discounted = discountedPrice(regular)

          return (
            <div
              key={tier}
              className={cn(
                'bg-white rounded-2xl border p-6 flex flex-col',
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
              <h3 className="text-lg font-bold text-gray-900">{info.label}</h3>

              {/* Precio */}
              <div className="mt-3 mb-1">
                <div className="flex items-end gap-2">
                  <span className="text-2xl font-bold text-gray-900">
                    {formatPriceCLP(regular)}
                  </span>
                  <span className="text-sm text-gray-400 mb-0.5">CLP/mes</span>
                </div>
                <p className="text-xs text-violet-600 font-semibold mt-1">
                  1° mes gratis · luego {formatPriceCLP(discounted)}/mes × 3
                </p>
              </div>

              {/* Features */}
              <ul className="space-y-2 mt-4 mb-6 flex-1">
                {features.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                    <Check className="h-4 w-4 text-violet-500 flex-shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>

              {/* CTA */}
              {isCurrent ? (
                <button
                  disabled
                  className="text-sm font-semibold px-4 py-2.5 rounded-xl bg-gray-100 text-gray-400 cursor-not-allowed"
                >
                  Plan activo
                </button>
              ) : (
                <a
                  href={`mailto:hola@scence.cl?subject=Quiero activar Plan ${info.label} en SCENCE&body=Hola, quiero activar el Plan ${info.label} (${formatPriceCLP(regular)} CLP/mes) para mi marca.`}
                  className={cn(
                    'flex items-center justify-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors',
                    highlight
                      ? 'bg-violet-600 text-white hover:bg-violet-700'
                      : 'border border-gray-200 text-gray-700 hover:bg-gray-50',
                  )}
                >
                  Solicitar plan
                  <ArrowRight className="h-4 w-4" />
                </a>
              )}
            </div>
          )
        })}
      </div>

      {/* Nota método de pago */}
      <p className="text-xs text-gray-400 text-center pb-4">
        El método de pago oficial será Transbank / tarjeta de crédito. Activación próximamente.
      </p>
    </div>
  )
}
