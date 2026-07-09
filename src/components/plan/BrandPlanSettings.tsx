'use client'

/**
 * BrandPlanSettings — UI de suscripción SaaS de marca.
 * Usado en /brand-settings/plan.
 * No es billing operativo ni payroll.
 */

import { useEffect, useState, useCallback } from 'react'
import { Check, RefreshCw, Sparkles, Clock, ArrowRight, BadgeCheck } from 'lucide-react'
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
      'Hasta 10 creadoras activas',
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

function secondMonthPrice(amount: number) {
  return Math.round(amount * 0.5)
}

export function BrandPlanSettings() {
  const [orgPlan, setOrgPlan] = useState<string>('free')
  const [loading, setLoading] = useState(true)
  const [checkoutLoading, setCheckoutLoading] = useState<PlanTier | null>(null)

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

  async function activatePlan(tier: PlanTier, paymentMethod: 'Mercado Pago' | 'PayPal') {
    const plan = PLAN_LIMITS[tier]

    if (paymentMethod === 'PayPal') {
      setCheckoutLoading(tier)
      try {
        const res = await fetch('/api/paypal/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tier }),
        })

        const json = await res.json()

        if (!res.ok) throw new Error(json.error ?? 'No se pudo iniciar PayPal')

        if (json.url) {
          window.location.href = json.url
          return
        }

        throw new Error('PayPal no devolvió URL de pago')
      } catch (e) {
        toast.error((e as Error).message)
      } finally {
        setCheckoutLoading(null)
      }

      return
    }

    // Mercado Pago: antes este botón nunca llamaba al backend (que sí está
    // implementado, ver /api/mercadopago/checkout) y siempre caía directo al
    // mailto manual — aunque MERCADOPAGO_ACCESS_TOKEN estuviera configurado.
    // Ahora intenta el checkout real primero; si el endpoint avisa que Mercado
    // Pago todavía no está activado (`json.manual`), recién ahí cae al mailto.
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

      if (!json.manual) {
        toast.error(json.error ?? 'No se pudo iniciar Mercado Pago')
        return
      }
      // json.manual === true: Mercado Pago aún no configurado, sigue al mailto.
    } catch {
      // Error de red — igual cae al mailto como respaldo.
    } finally {
      setCheckoutLoading(null)
    }

    const subject = `Quiero activar Plan ${plan.label} en SCENCE por ${paymentMethod}`
    const body = `Hola, quiero activar el Plan ${plan.label} (${formatPriceCLP(plan.price_monthly_clp)} CLP/mes) para mi marca. Prefiero pagar por ${paymentMethod}. Entiendo que la suscripción mínima es de 3 meses, con primer mes gratis y segundo mes con 50% de descuento.`

    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=hola@scence.cl&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`

    window.location.href = gmailUrl
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
          Tu plan actual: <span className="font-bold">{currentInfo.label}</span>
          {' · '}
          {currentTier === 'basic'
            ? 'Acceso básico a SCENCE'
            : currentTier === 'growth'
              ? 'Más creadoras, marcas y reportería'
              : 'Acceso ilimitado a todo'}
        </p>
      </div>

      {/* Banner: activación */}
      <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-5 py-4 flex items-start gap-3">
        <Clock className="h-5 w-5 text-emerald-500 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-emerald-800">Activación manual disponible</p>
          <p className="text-xs text-emerald-700 mt-0.5">
            Puedes solicitar tu plan por Mercado Pago o PayPal. Activamos la suscripción manualmente mientras finalizamos el checkout automático.
          </p>
        </div>
      </div>

      {/* Oferta comercial */}
      <div className="bg-gradient-to-r from-violet-600 to-violet-500 rounded-2xl px-6 py-5 text-white">
        <div className="flex items-center gap-2 mb-2">
          <BadgeCheck className="h-5 w-5 text-violet-200" />
          <span className="text-xs font-bold text-violet-100 uppercase tracking-wide">Oferta de lanzamiento</span>
        </div>
        <p className="text-lg font-bold mb-1">Primer mes gratis + segundo mes con 50% de descuento</p>
        <p className="text-sm text-violet-200">
          Activa SCENCE con compromiso mínimo de 3 meses: prueba gratis, paga menos en el segundo mes y continúa con tu plan normal desde el tercer mes.
        </p>
        <div className="mt-4 flex flex-wrap gap-3 text-xs font-semibold">
          <span className="bg-white/20 rounded-full px-3 py-1">Mes 1: Gratis</span>
          <span className="bg-white/20 rounded-full px-3 py-1">Mes 2: −50%</span>
          <span className="bg-white/20 rounded-full px-3 py-1">Mes 3: precio regular</span>
          <span className="bg-white/20 rounded-full px-3 py-1">Mínimo 3 meses</span>
        </div>
      </div>

      {/* Cards de planes */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {PLAN_DEFS.map(({ tier, highlight, features }) => {
          const info       = PLAN_LIMITS[tier]
          const isCurrent  = tier === currentTier
          const regular    = info.price_monthly_clp
          const discounted = secondMonthPrice(regular)

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
                <p className="text-xs text-violet-600 font-semibold mt-1">
                  1° mes gratis · 2° mes {formatPriceCLP(discounted)} · mínimo 3 meses
                </p>
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
                    onClick={() => activatePlan(tier, 'Mercado Pago')}
                    disabled={checkoutLoading === tier}
                    className={cn(
                      'w-full flex items-center justify-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl transition-colors disabled:opacity-60',
                      highlight
                        ? 'bg-violet-600 text-white hover:bg-violet-700'
                        : 'border border-gray-200 text-gray-700 hover:bg-gray-50',
                    )}
                  >
                    Solicitar por Mercado Pago
                    <ArrowRight className="h-4 w-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() => activatePlan(tier, 'PayPal')}
                    disabled={checkoutLoading === tier}
                    className="w-full flex items-center justify-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-60"
                  >
                    Solicitar por PayPal
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
        Suscripción mínima de 3 meses. Activación disponible por Mercado Pago o PayPal durante la oferta de lanzamiento.
      </p>
    </div>
  )
}
