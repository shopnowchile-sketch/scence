'use client'

import { useEffect, useState, useCallback } from 'react'
import { Check, CreditCard, RefreshCw, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface Plan {
  id: string
  tier: string
  name: string
  description: string | null
  price_monthly: number
  price_yearly: number | null
  max_users: number | null
  max_campaigns: number | null
  max_influencers: number | null
  features: string[]
  is_active: boolean
  stripe_price_id_monthly: string | null
  stripe_price_id_yearly: string | null
}

interface Subscription {
  id: string
  plan_id: string
  status: string
  current_period_end: string | null
  plan: Plan | null
}

function fmtCLP(n: number) {
  return n.toLocaleString('es-CL')
}

export default function BrandBillingPage() {
  const [plans, setPlans]               = useState<Plan[]>([])
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [loading, setLoading]           = useState(true)
  const [busyPlanId, setBusyPlanId]     = useState<string | null>(null)
  const [portalBusy, setPortalBusy]     = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/brand/billing')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setPlans(json.plans ?? [])
      setSubscription(json.subscription ?? null)
    } catch (e) {
      toast.error((e as Error).message ?? 'Error cargando planes')
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const currentPlanId = subscription?.status === 'active' || subscription?.status === 'trialing'
    ? subscription.plan_id
    : null

  async function handleContratar(plan: Plan) {
    setBusyPlanId(plan.id)
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_id: plan.id }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'No se pudo iniciar el pago')
      window.location.href = json.url
    } catch (e) {
      toast.error((e as Error).message)
      setBusyPlanId(null)
    }
  }

  async function handleGestionar() {
    setPortalBusy(true)
    try {
      const res = await fetch('/api/stripe/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ return_url: `${window.location.origin}/brand-billing` }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'No se pudo abrir el portal')
      window.location.href = json.url
    } catch (e) {
      toast.error((e as Error).message)
      setPortalBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-10 h-10 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Billing</h1>
          <p className="text-sm text-gray-400 mt-0.5">Planes de suscripción para tu marca</p>
        </div>
        <div className="flex items-center gap-2">
          {subscription && subscription.status !== 'canceled' && (
            <button
              onClick={handleGestionar}
              disabled={portalBusy}
              className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              <CreditCard className="h-4 w-4" /> Gestionar suscripción
            </button>
          )}
          <button onClick={load} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {subscription && (
        <div className="bg-violet-50 border border-violet-100 rounded-2xl p-4 flex items-center gap-3">
          <Sparkles className="h-5 w-5 text-violet-500 flex-shrink-0" />
          <p className="text-sm text-violet-700">
            Plan actual: <span className="font-bold">{subscription.plan?.name ?? '—'}</span>
            {' · '}Estado: <span className="font-semibold">{subscription.status}</span>
            {subscription.current_period_end && (
              <> · Próxima renovación: {new Date(subscription.current_period_end).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' })}</>
            )}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {plans.map(plan => {
          const isCurrent = plan.id === currentPlanId
          const isEnterprise = plan.tier === 'enterprise'

          return (
            <div
              key={plan.id}
              className={cn(
                'bg-white rounded-2xl border p-6 flex flex-col',
                isCurrent ? 'border-violet-400 ring-1 ring-violet-200' : 'border-gray-100'
              )}
            >
              {isCurrent && (
                <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-violet-100 text-violet-700 w-fit mb-3">
                  Tu plan actual
                </span>
              )}
              <h3 className="text-lg font-bold text-gray-900">{plan.name}</h3>
              <p className="text-xs text-gray-400 mt-1 min-h-[32px]">{plan.description}</p>

              <div className="mt-4 mb-5">
                <span className="text-2xl font-bold text-gray-900">
                  {isEnterprise ? 'Desde ' : ''}${fmtCLP(plan.price_monthly)}
                </span>
                <span className="text-sm text-gray-400"> CLP/mes{isEnterprise ? ' + IVA' : ''}</span>
              </div>

              <ul className="space-y-2 mb-6 flex-1">
                {plan.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                    <Check className="h-4 w-4 text-violet-500 flex-shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>

              {isEnterprise ? (
                <a
                  href="mailto:hola@scence.cl?subject=Plan Enterprise SCENCE"
                  className="text-center text-sm font-semibold px-4 py-2.5 rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50"
                >
                  Hablar con ventas
                </a>
              ) : isCurrent ? (
                <button
                  disabled
                  className="text-sm font-semibold px-4 py-2.5 rounded-xl bg-gray-100 text-gray-400 cursor-not-allowed"
                >
                  Plan activo
                </button>
              ) : (
                <button
                  onClick={() => handleContratar(plan)}
                  disabled={busyPlanId === plan.id}
                  className="text-sm font-semibold px-4 py-2.5 rounded-xl bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
                >
                  {busyPlanId === plan.id ? 'Redirigiendo…' : 'Contratar'}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
