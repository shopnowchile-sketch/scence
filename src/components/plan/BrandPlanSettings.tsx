'use client'

/**
 * BrandPlanSettings — UI de suscripción SaaS de marca.
 * Usado en /brand-settings/plan.
 * No es billing operativo ni payroll.
 */

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Check, RefreshCw, Sparkles, Clock, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { AgencyPlanCard } from './AgencyPlanCard'
import {
  PLAN_LIMITS, BRAND_PLANS_FOR_SALE, BRAND_PLAN_COMMERCIAL_NAME, BRAND_PLAN_INTRO_CLP, BRAND_PLAN_USD_PRICING, PRICE_FX_NOTICE,
  brandPlanUsdTerms, getPlanTier, formatPriceCLP, type PlanTier,
} from '@/lib/plan-limits'

// Solo los planes a la venta (SCORE). El plan Pro antiguo no se ofrece; quien lo tiene asignado lo conserva.
const PLAN_DEFS: Array<{
  tier: PlanTier
  highlight?: boolean
  subtitle: string
  features: string[]
}> = ([
  {
    tier: 'basic',
    subtitle: 'Plataforma, sin gestión',
    features: [
      'Campañas abiertas con postulaciones de creadoras',
      '1 campaña activa a la vez',
      'Hasta 5 creadoras por campaña vigente',
      'Contenido ilimitado',
      'Programa de afiliados / códigos',
      '1 marca incluida',
      'Hasta 5 usuarios',
      'Reportería básica de campañas',
    ],
  },
  {
    tier: 'growth',
    highlight: true,
    subtitle: 'Marcas con entrenamiento · Pymes con gestión',
    features: [
      'Campañas abiertas y privadas sin límite',
      'Hasta 50 creadoras activas',
      'Contenido ilimitado',
      'Programa de afiliados / códigos',
      'Marcas: entrenamiento para tu equipo (gestión de campañas como servicio aparte)',
      'Pymes con gestión: plataforma y gestión de campañas incluidas',
      'Reportería avanzada de campañas',
      'Soporte preferente',
    ],
  },
] satisfies Array<{ tier: PlanTier; highlight?: boolean; subtitle: string; features: string[] }>).filter(plan => BRAND_PLANS_FOR_SALE.includes(plan.tier))


export function BrandPlanSettings() {
  const router = useRouter()
  const [orgPlan, setOrgPlan] = useState<string>('free')
  const [loading, setLoading] = useState(true)
  const [checkoutLoading, setCheckoutLoading] = useState<{ tier: PlanTier; provider: 'paypal' } | null>(null)
  const [prices, setPrices] = useState<Partial<Record<PlanTier, number>>>({})
  const [paymentProcessing, setPaymentProcessing] = useState(false)
  const [hasActiveSubscription, setHasActiveSubscription] = useState(false)
  // Agencia multimarca: la marca activa paga su propia mensualidad (en vez de los planes Basic/Growth/Pro).
  const [agency, setAgency] = useState<{ brandId: string; brandName: string | null } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch('/api/brand/billing')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      const agencyRes = await fetch('/api/brand/agency', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).catch(() => null)
      const agencyBrand = agencyRes?.is_agency ? agencyRes.brands?.find((b: { id: string }) => b.id === agencyRes.active_brand_id) : null
      setAgency(agencyBrand ? { brandId: agencyBrand.id, brandName: agencyBrand.name } : null)
      setOrgPlan(json.org_plan ?? 'free')
      setHasActiveSubscription(json.has_active_subscription === true)
      const nextPrices: Partial<Record<PlanTier, number>> = {}
      for (const plan of json.plans ?? []) {
        if (plan.tier === 'basic' || plan.tier === 'growth' || plan.tier === 'pro') {
          const tier = plan.tier as PlanTier
          const amount = Number(plan.price_monthly)
          if (Number.isFinite(amount) && amount > 0) nextPrices[tier] = amount
        }
      }
      setPrices(nextPrices)
    } catch (e) {
      toast.error((e as Error).message ?? 'Error cargando plan')
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('checkout') !== 'processing') return
    const subscriptionId = new URLSearchParams(window.location.search).get('subscription_id')
    if (!subscriptionId) return
    setPaymentProcessing(true)
    fetch(`/api/paypal/complete?subscription_id=${encodeURIComponent(subscriptionId)}`, { method: 'POST' })
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error)
        const params = new URLSearchParams(window.location.search)
        const campaign = params.get('campaign')
        toast.success(json.tier === 'agency' ? 'Mensualidad activa. Ya puedes continuar con tu campaña.' : campaign ? 'Tu pago fue confirmado. Ya puedes enviar tu campaña a aprobación.' : 'Tu pago fue confirmado. Ahora crea tu primera campaña.')
        window.history.replaceState({}, '', window.location.pathname)
        await load()
        // El pago solo habilita el envío: la campaña sigue en borrador hasta que la envíes y SCENCE la apruebe.
        router.replace(json.nda_signed === false
          ? (campaign ? `/brand-documents?campaign=${encodeURIComponent(campaign)}` : '/brand-documents')
          : campaign ? `/brand-campaigns/${campaign}` : json.tier === 'agency' ? '/brand-campaigns' : '/brand-campaigns/new')
      })
      .catch((error) => toast.error(error.message ?? 'Estamos confirmando tu pago.'))
      .finally(() => setPaymentProcessing(false))
  }, [load, router])

  const currentTier = getPlanTier(orgPlan)
  const currentInfo = PLAN_LIMITS[currentTier]

  async function activatePlan(tier: PlanTier, provider: 'paypal') {
    setCheckoutLoading({ tier, provider })
    try {
      const res = await fetch(`/api/${provider}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Si vino desde «Enviar a aprobación», la campaña viaja para volver a ella después del pago.
        body: JSON.stringify({ tier, campaign_id: new URLSearchParams(window.location.search).get('campaign') ?? undefined }),
      })

      const json = await res.json()

      if (res.ok && json.url) {
        window.location.href = json.url
        return
      }

      toast.error(json.error ?? 'No se pudo iniciar PayPal')
    } catch (e) {
      toast.error((e as Error).message ?? 'No se pudo conectar con el medio de pago')
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

  if (agency) {
    return (
      <div className="max-w-lg space-y-4">
        {paymentProcessing && <p className="text-sm text-amber-700">Estamos confirmando tu pago con PayPal…</p>}
        <AgencyPlanCard brandId={agency.brandId} brandName={agency.brandName} />
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

      {/* Estado de suscripción */}
      <div className={cn('rounded-2xl border p-4 flex items-center gap-3', hasActiveSubscription ? 'bg-violet-50 border-violet-100' : 'bg-amber-50 border-amber-200')}>
        <Sparkles className="h-5 w-5 text-violet-500 flex-shrink-0" />
        <p className={cn('text-sm', hasActiveSubscription ? 'text-violet-700' : 'text-amber-900')}>
          {hasActiveSubscription ? <>Tu plan actual: <span className="font-bold">{currentInfo.label}</span>{' · '}{currentTier === 'basic' ? 'Acceso básico a SCENCE' : currentTier === 'growth' ? 'Más creadoras, marcas y reportería' : 'Acceso ilimitado a todo'}</> : <>Tu período de acceso gratuito ha finalizado. Elige el plan que mejor se adapte a tu marca para continuar creando campañas en SCENCE.</>}
        </p>
      </div>

      {paymentProcessing && (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 flex items-start gap-3">
        <Clock className="h-5 w-5 text-emerald-500 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-amber-800">Estamos confirmando tu pago</p>
          <p className="text-xs text-amber-700 mt-0.5">
            El medio de pago nos avisará cuando la suscripción quede aprobada. Esta página se actualizará automáticamente en unos segundos.
          </p>
        </div>
      </div>
      )}

      {/* Cards de planes */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {PLAN_DEFS.map(({ tier, highlight, subtitle, features }) => {
          const info       = PLAN_LIMITS[tier]
          const isCurrent  = hasActiveSubscription && tier === currentTier
          const regular    = prices[tier] ?? info.price_monthly_clp
          const intro      = BRAND_PLAN_INTRO_CLP[tier]

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
              <h3 className="text-base font-bold text-gray-900">{BRAND_PLAN_COMMERCIAL_NAME[tier]}</h3>
              <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>

              {/* Precio */}
              <div className="mt-3 mb-1">
                <div className="flex items-end gap-1.5">
                  <span className="text-xl font-bold text-gray-900">
                    {formatPriceCLP(regular)}
                  </span>
                  <span className="text-xs text-gray-400 mb-0.5">CLP/mes · IVA incluido</span>
                </div>
                {intro && <p className="text-xs font-semibold text-violet-700 mt-1">Primer mes: {formatPriceCLP(intro)} CLP</p>}
                <p className="text-xs text-gray-500 mt-1">Cobro mensual automático con PayPal</p>
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
                    onClick={() => activatePlan(tier, 'paypal')}
                    disabled={checkoutLoading?.tier === tier}
                    className="w-full flex items-center justify-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl border border-[#0070ba]/25 text-[#003087] hover:bg-[#f5f9ff] transition-colors disabled:opacity-60"
                  >
                    {checkoutLoading?.tier === tier && checkoutLoading.provider === 'paypal' ? 'Abriendo PayPal…' : `PayPal · US$${BRAND_PLAN_USD_PRICING[tier].launch}${intro ? ' el primer mes' : '/mes'}`}
                    <ArrowRight className="h-4 w-4" />
                  </button>
                  <p className="text-[11px] leading-4 text-center text-gray-400 -mt-0.5">
                    Cobro en USD: {brandPlanUsdTerms(tier)}.
                  </p>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Nota método de pago */}
      <p className="text-xs text-gray-400 text-center pb-4">
        {PRICE_FX_NOTICE} Tu acceso se actualiza cuando la suscripción sea aprobada.
      </p>
    </div>
  )
}
