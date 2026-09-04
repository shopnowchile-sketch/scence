'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, LockKeyhole, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'
import { INFLUENCER_PRO_TERMS } from '@/lib/influencer-pro-terms'

type Billing = {
  subscription: { status: string; current_period_end: string | null; plan: { name: string; tier: string } | null } | null
  commitment: { campaignName: string; completedDeliverables: number; totalDeliverables: number } | null
  can_cancel: boolean
  is_pro: boolean
  account_active: boolean
  blocked_reason?: 'campaign_active' | 'deliverables_pending' | null
}

async function responseJson(response: Response) {
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    throw new Error(response.status === 404 ? 'El endpoint de suscripción no está disponible. Reinicia el servidor local.' : 'El servidor no pudo procesar la solicitud. Intenta nuevamente.')
  }
  return response.json()
}

export function InfluencerPlanSettings({ embedded = false }: { embedded?: boolean }) {
  const [billing, setBilling] = useState<Billing | null>(null)
  const [loading, setLoading] = useState(true)
  const [canceling, setCanceling] = useState(false)
  const [upgrading, setUpgrading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/influencer/billing', { cache: 'no-store' })
      const result = await responseJson(response)
      if (!response.ok) throw new Error(result.error)
      setBilling(result)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo cargar tu plan.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('checkout') !== 'processing') return
    const subscriptionId = params.get('subscription_id')
    if (!subscriptionId) return
    // Si el upgrade se inició desde una campaña (return_campaign_id viaja en
    // el return_url de PayPal, ver /api/influencer/paypal/checkout), volvemos
    // ahí en vez de quedarnos en Mi Plan — no cambia nada de la confirmación
    // de la suscripción en sí.
    const returnCampaignId = params.get('return_campaign_id')
    setUpgrading(true)
    fetch(`/api/influencer/paypal/complete?subscription_id=${encodeURIComponent(subscriptionId)}`, { method: 'POST' })
      .then(async response => {
        const result = await responseJson(response)
        if (!response.ok) throw new Error(result.error)
        toast.success('Tu Plan Pro está activo.')
        if (returnCampaignId) { window.location.replace(`/inf-campaign/${returnCampaignId}`); return }
        window.history.replaceState({}, '', '/inf-profile?tab=plan')
        return load()
      })
      .catch(error => toast.error(error instanceof Error ? error.message : 'No se pudo confirmar la suscripción.'))
      .finally(() => setUpgrading(false))
  }, [load])

  async function upgradeToPro() {
    setUpgrading(true)
    try {
      const acceptanceResponse = await fetch('/api/influencer/terms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accepted: true, document_key: INFLUENCER_PRO_TERMS.key, version: INFLUENCER_PRO_TERMS.version }) })
      const acceptanceResult = await responseJson(acceptanceResponse)
      if (!acceptanceResponse.ok) throw new Error(acceptanceResult.error)
      const returnCampaignId = new URLSearchParams(window.location.search).get('return_campaign_id')
      const response = await fetch('/api/influencer/paypal/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(returnCampaignId ? { return_campaign_id: returnCampaignId } : {}),
      })
      const result = await responseJson(response)
      if (!response.ok || !result.url) throw new Error(result.error ?? 'No se pudo iniciar PayPal.')
      window.location.href = result.url
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo iniciar PayPal.')
      setUpgrading(false)
    }
  }

  async function cancelSubscription() {
    if (!window.confirm('¿Quieres cancelar tu suscripción Pro?')) return
    setCanceling(true)
    try {
      const response = await fetch('/api/influencer/paypal/cancel', { method: 'POST' })
      const result = await responseJson(response)
      if (!response.ok) throw new Error(result.error)
      toast.success('Tu suscripción fue cancelada correctamente.')
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo cancelar tu suscripción.')
    } finally {
      setCanceling(false)
    }
  }

  if (loading) return <div className="min-h-[40vh] flex items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-violet-200 border-t-violet-600" /></div>

  const active = billing?.is_pro === true
  const commitment = billing?.commitment
  const benefits = ['Postulaciones a eventos exclusivos', 'Primeros en ser considerados para invitaciones públicas', 'Invitaciones exclusivas VIP', 'Descuentos cuando la campaña sea pagada', 'Beneficios específicos adicionales según cada campaña']

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {!embedded && <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Mi Plan</h1>
          <p className="mt-1 text-sm text-gray-500">Administra tu suscripción de Influencer.</p>
        </div>
        <button onClick={() => void load()} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100" aria-label="Actualizar"><RefreshCw className="h-4 w-4" /></button>
      </div>}

      {!active && billing?.account_active && (
        <section className="overflow-hidden rounded-2xl border border-violet-200 bg-white shadow-sm">
          <div className="flex items-center justify-between bg-violet-600 px-5 py-4 text-white">
            <div><p className="text-xs font-semibold text-violet-100">PLAN ACTUAL: GRATIS</p><h2 className="text-xl font-bold">Cambia a Plan Pro</h2></div>
            <div className="text-right"><strong className="text-xl">$7.990</strong><p className="text-xs text-violet-100">CLP / mes</p></div>
          </div>
          <div className="p-5">
            <div className="grid gap-2 sm:grid-cols-2">
              {benefits.map(benefit => (
                <div key={benefit} className="flex items-start gap-2 text-sm text-gray-700">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
                  <span>{benefit}</span>
                </div>
              ))}
            </div>
            <button onClick={upgradeToPro} disabled={upgrading} className="mt-5 w-full rounded-xl bg-violet-600 px-5 py-3 text-sm font-extrabold text-white transition hover:bg-violet-700 disabled:opacity-50">
              {upgrading ? 'ABRIENDO PAYPAL…' : 'CAMBIAR A PLAN PRO'}
            </button>
            <p className="mt-2 text-center text-[11px] text-gray-400">Pago mensual con PayPal. Al continuar aceptas los <Link href="/terms/influencer-pro" target="_blank" className="text-violet-600 hover:underline">términos del Plan Pro</Link>.</p>
          </div>
        </section>
      )}

      {active && (
        <section className="rounded-2xl border border-violet-200 bg-white p-5">
          <div className="flex items-center justify-between"><h3 className="font-bold text-gray-900">PLAN PRO</h3><span className="font-bold text-violet-700">$7.990/mes</span></div>
          <div className="mt-4 space-y-3">{benefits.map(benefit => <div key={benefit} className="flex items-start gap-2 text-sm text-gray-700"><Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-violet-600" /><span>{benefit}</span></div>)}</div>
        </section>
      )}

      {active && commitment && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <div className="flex gap-3">
            <LockKeyhole className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
            <div>
              <h3 className="font-semibold text-amber-900">Suscripción comprometida con campaña</h3>
              <p className="mt-1 text-sm text-amber-800">Podrás cancelar cuando la campaña termine y hayas completado todos tus entregables.</p>
              <div className="mt-3 text-sm text-amber-900"><p><strong>Campaña:</strong> {commitment.campaignName}</p><p><strong>Entregables:</strong> {commitment.completedDeliverables}/{commitment.totalDeliverables}</p></div>
            </div>
          </div>
        </section>
      )}

      {active && (
        <section className="rounded-2xl border border-gray-100 bg-white p-6">
          <h3 className="font-semibold text-gray-900">Cancelar suscripción</h3>
          <p className="mt-1 text-sm text-gray-500">La cancelación se procesa directamente con PayPal.</p>
          <button disabled={!billing?.can_cancel || canceling} onClick={cancelSubscription} className="mt-4 rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40">{canceling ? 'Cancelando…' : commitment ? 'Cancelación bloqueada' : 'Cancelar suscripción'}</button>
        </section>
      )}

      <p className="text-center text-xs text-gray-400">Si quieres desactivar tu cuenta, escríbenos a <a href="mailto:hola@sense.cl" className="font-semibold text-violet-600 hover:underline">hola@sense.cl</a> explicándonos por qué quieres desactivarla.</p>
    </div>
  )
}
