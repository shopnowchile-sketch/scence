'use client'

import { useEffect, useState } from 'react'
import { CreditCard, Download, RefreshCw, CheckCircle2, CalendarDays } from 'lucide-react'
import { toast } from 'sonner'

type Payment = {
  id: string
  gateway: string
  gateway_payment_id: string | null
  amount: number | string
  currency: string
  status: string
  paid_at: string
  period_start: string | null
  period_end: string | null
  receipt_url: string | null
}

type Data = {
  summary: {
    status: string | null
    started_paying_at: string | null
    next_billing_at: string | null
    current_amount: { amount: number | string; currency: string } | null
    total_paid: number
    total_paid_currency: string | null
  }
  payments: Payment[]
}

function money(amount: number | string, currency: string) {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency }).format(Number(amount))
}

function date(value: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeZone: 'America/Santiago' }).format(new Date(value))
}

export function ProSubscriptionSection({ influencerId, isPro, proSource }: { influencerId: string; isPro: boolean; proSource?: 'paid' | 'manual' | 'free' }) {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(false)

  async function load() {
    if (!isPro) return
    setLoading(true)
    try {
      const response = await fetch(`/api/admin/subscription-payments?influencer_id=${encodeURIComponent(influencerId)}`, { cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      setData(result)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo cargar la suscripción Pro.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [influencerId, isPro])

  if (!isPro) return null

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between gap-3 mb-5">
        <div>
          <div className="flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-violet-600" />
            <h3 className="text-sm font-bold text-gray-900">Suscripción Pro</h3>
          </div>
          <p className="mt-1 text-xs text-gray-400">Cobros reales registrados en subscription_payments.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="rounded-lg p-2 text-gray-400 hover:bg-gray-50 disabled:opacity-50" aria-label="Actualizar">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {loading && !data ? (
        <div className="py-8 text-center text-sm text-gray-400">Cargando pagos…</div>
      ) : data ? (
        <>
          {proSource === 'paid' && (
            <div className="mb-4 overflow-hidden rounded-2xl border border-violet-200 bg-gradient-to-r from-violet-50 via-white to-emerald-50">
              <div className="flex flex-wrap items-center justify-between gap-4 p-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-600 text-white shadow-sm">
                    <CheckCircle2 className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-extrabold uppercase tracking-wider text-violet-700">SCENCE PRO</span>
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-extrabold uppercase text-emerald-700">PAGA</span>
                    </div>
                    <p className="mt-0.5 text-sm font-semibold text-gray-900">Suscripción activa con cobros reales</p>
                  </div>
                </div>
                <div className="flex items-center gap-5">
                  {data.summary.current_amount && (
                    <div className="text-right">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Cobro mensual</div>
                      <div className="text-lg font-black text-gray-950">{money(data.summary.current_amount.amount, data.summary.current_amount.currency)}</div>
                    </div>
                  )}
                  {data.summary.next_billing_at && (
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <CalendarDays className="h-4 w-4 text-violet-500" />
                      Próximo cobro {date(data.summary.next_billing_at)}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="rounded-xl bg-gray-50 p-3"><div className="text-[11px] text-gray-400">Estado</div><div className="mt-1 text-sm font-bold text-gray-900 capitalize">{data.summary.status ?? '—'}</div></div>
            <div className="rounded-xl bg-gray-50 p-3"><div className="text-[11px] text-gray-400">Inicio de pago</div><div className="mt-1 text-sm font-bold text-gray-900">{date(data.summary.started_paying_at)}</div></div>
            <div className="rounded-xl bg-gray-50 p-3"><div className="text-[11px] text-gray-400">Próximo cobro</div><div className="mt-1 text-sm font-bold text-gray-900">{date(data.summary.next_billing_at)}</div></div>
            <div className="rounded-xl bg-gray-50 p-3"><div className="text-[11px] text-gray-400">Monto actual</div><div className="mt-1 text-sm font-bold text-gray-900">{data.summary.current_amount ? money(data.summary.current_amount.amount, data.summary.current_amount.currency) : '—'}</div></div>
            <div className="rounded-xl bg-gray-50 p-3"><div className="text-[11px] text-gray-400">Total pagado</div><div className="mt-1 text-sm font-bold text-gray-900">{data.summary.total_paid_currency ? money(data.summary.total_paid, data.summary.total_paid_currency) : '—'}</div></div>
          </div>

          <div className="mt-5 overflow-x-auto">
            {data.payments.length ? (
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-[11px] uppercase tracking-wider text-gray-400">
                    <th className="px-2 py-3">Fecha</th>
                    <th className="px-2 py-3">Período</th>
                    <th className="px-2 py-3">Monto</th>
                    <th className="px-2 py-3">Gateway</th>
                    <th className="px-2 py-3">Estado</th>
                    <th className="px-2 py-3 text-right">PDF</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {data.payments.map(payment => (
                    <tr key={payment.id}>
                      <td className="px-2 py-3 whitespace-nowrap text-gray-600">{date(payment.paid_at)}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-gray-500">{payment.period_start || payment.period_end ? `${date(payment.period_start)} → ${date(payment.period_end)}` : 'No informado'}</td>
                      <td className="px-2 py-3 whitespace-nowrap font-semibold text-gray-900">{money(payment.amount, payment.currency)}</td>
                      <td className="px-2 py-3 capitalize text-gray-500">{payment.gateway}</td>
                      <td className="px-2 py-3 capitalize text-gray-500">{payment.status}</td>
                      <td className="px-2 py-3 text-right">
                        <a href={`/api/admin/subscription-payments/${payment.id}/pdf`} download className="inline-flex items-center gap-1.5 font-semibold text-violet-600 hover:underline">
                          <Download className="h-3.5 w-3.5" /> PDF
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="rounded-xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-400">No hay pagos Pro registrados para esta influencer.</div>
            )}
          </div>
        </>
      ) : null}
    </section>
  )
}
