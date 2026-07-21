'use client'

import { useEffect, useMemo, useState } from 'react'
import { Gift, Loader2, Pencil, Plus, Trash2, Search, Save } from 'lucide-react'
import { toast } from 'sonner'
import { cn, formatCurrency } from '@/lib/utils'
import {
  BARTER_BENEFIT_TYPE_CONFIG,
  type Barter,
  type BarterSimpleStatus,
  type CampaignBenefit,
  type CampaignInfluencerDetail,
} from '@/types'
import { useBarterAction, useCampaignBarters, useInitializeCampaignBarters } from '@/hooks/useBarters'

export function BartersTab({
  campaignId,
  campaignInfluencers,
  campaignBenefits,
  onSaveBenefits,
}: {
  campaignId: string
  campaignInfluencers: CampaignInfluencerDetail[]
  campaignBenefits: CampaignBenefit[]
  onSaveBenefits: (benefits: CampaignBenefit[]) => Promise<unknown>
}) {
  const { data: barters = [], isLoading } = useCampaignBarters(campaignId)
  const initialize = useInitializeCampaignBarters(campaignId)
  const acceptedCount = campaignInfluencers.filter(item => item.application_status === 'accepted').length
  const [editingOffer, setEditingOffer] = useState(false)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | BarterSimpleStatus>('all')

  useEffect(() => {
    if (!isLoading && campaignBenefits.length > 0 && acceptedCount > barters.length && !initialize.isPending && !initialize.isSuccess) {
      initialize.mutate()
    }
  }, [acceptedCount, barters.length, campaignBenefits.length, initialize, isLoading])

  const counts = useMemo(() => {
    const result: Record<BarterSimpleStatus, number> = { pending: 0, completed: 0, problem: 0 }
    for (const barter of barters) {
      if (campaignBenefits.length === 0) result[getSimpleStatus(barter)] += 1
      else campaignBenefits.forEach((_, index) => result[getBenefitTracking(barter, index).status] += 1)
    }
    return result
  }, [barters, campaignBenefits])

  const filteredBarters = useMemo(() => {
    const term = normalizeSearch(query)
    return barters.filter(barter => {
      const matchesSearch = normalizeSearch([
        barter.influencer?.display_name,
        barter.influencer?.email,
        barter.influencer?.instagram_username,
      ].filter(Boolean).join(' ')).includes(term)
      const matchesStatus = statusFilter === 'all' || effectiveBenefits(barter, campaignBenefits)
        .some((_, index) => getBenefitTracking(barter, index).status === statusFilter)
      return matchesSearch && matchesStatus
    })
  }, [barters, campaignBenefits, query, statusFilter])

  return (
    <div className="space-y-5">
      <section className="card p-5 border border-violet-100 bg-violet-50/30">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-violet-100 p-2.5"><Gift className="h-5 w-5 text-violet-600" /></div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-gray-900">Beneficios de esta campaña</h3>
            <p className="text-xs text-gray-500 mt-1">
              Son iguales para todas las influencers y se muestran antes de postular.
            </p>
          </div>
          {!editingOffer && (
            <button type="button" onClick={() => setEditingOffer(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-white px-3 py-2 text-xs font-semibold text-violet-700">
              <Pencil className="h-3.5 w-3.5" /> {campaignBenefits.length ? 'Editar' : 'Definir beneficios'}
            </button>
          )}
        </div>

        {editingOffer ? (
          <CampaignOfferEditor
            initialBenefits={campaignBenefits}
            onCancel={() => setEditingOffer(false)}
            onSave={async benefits => {
              await onSaveBenefits(benefits)
              setEditingOffer(false)
              toast.success('Beneficios de la campaña guardados')
            }}
          />
        ) : campaignBenefits.length === 0 ? (
          <p className="mt-4 rounded-lg bg-white px-4 py-3 text-sm text-gray-500">
            Esta campaña todavía no tiene beneficios definidos.
          </p>
        ) : (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {campaignBenefits.map((benefit, index) => (
              <div key={`${benefit.benefit_type}-${index}`} className="rounded-xl border border-violet-100 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-violet-700">
                      {BARTER_BENEFIT_TYPE_CONFIG[benefit.benefit_type]}
                    </p>
                    <p className="text-sm font-medium text-gray-900 mt-1">{benefit.description}</p>
                  </div>
                  {benefit.quantity > 1 && (
                    <span className="rounded-md bg-violet-50 px-2 py-1 text-xs font-semibold text-violet-700">×{benefit.quantity}</span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-2">{activationText(benefit)}</p>
                {benefit.estimated_value != null && benefit.estimated_value > 0 && (
                  <p className="text-xs font-semibold text-gray-700 mt-2">
                    Valor estimado: {formatCurrency(benefit.estimated_value, benefit.currency)}
                  </p>
                )}
                {benefit.benefit_type === 'sales_commission' && benefit.commission_rate != null && (
                  <p className="text-xs font-semibold text-gray-700 mt-2">Comisión: {benefit.commission_rate}% de las ventas</p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="grid grid-cols-3 gap-3">
        <StatusCount label="Pendientes" value={counts.pending} tone="amber" />
        <StatusCount label="Canjes enviados" value={counts.completed} tone="green" />
        <StatusCount label="Con problema" value={counts.problem} tone="red" />
      </div>

      <section className="space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-800">Seguimiento por influencer</h3>
            <p className="text-xs text-gray-500 mt-0.5">Actualiza cada beneficio y agrega una observación breve.</p>
          </div>
          <div className="flex w-full gap-2 sm:w-auto">
            <label className="relative block min-w-0 flex-1 sm:w-56">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-gray-400" />
              <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Nombre, email o Instagram"
                className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-8 pr-3 text-xs outline-none focus:border-violet-400" />
            </label>
            <select value={statusFilter} onChange={event => setStatusFilter(event.target.value as 'all' | BarterSimpleStatus)}
              className="rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs outline-none focus:border-violet-400">
              <option value="all">Todos</option>
              <option value="pending">Pendiente</option>
              <option value="completed">Canje enviado</option>
              <option value="problem">Con problema</option>
            </select>
          </div>
        </div>

        {isLoading || initialize.isPending ? (
          <div className="flex items-center justify-center py-10 text-gray-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : barters.length === 0 ? (
          <div className="card p-7 text-center text-sm text-gray-500">
            {acceptedCount === 0
              ? 'El seguimiento aparecerá cuando haya influencers aceptadas.'
              : 'No hay beneficios para seguir en esta campaña.'}
          </div>
        ) : (
          filteredBarters.length === 0 ? (
            <div className="card p-5 text-center text-xs text-gray-500">No encontramos influencers con esa búsqueda.</div>
          ) : filteredBarters.map(barter => (
            <TrackingRow key={barter.id} campaignId={campaignId} barter={barter} campaignBenefits={campaignBenefits} />
          ))
        )}
      </section>
    </div>
  )
}

function CampaignOfferEditor({ initialBenefits, onCancel, onSave }: {
  initialBenefits: CampaignBenefit[]
  onCancel: () => void
  onSave: (benefits: CampaignBenefit[]) => Promise<void>
}) {
  const [benefits, setBenefits] = useState<CampaignBenefit[]>(initialBenefits)
  const [saving, setSaving] = useState(false)
  const input = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-violet-400'

  function addBenefit() {
    setBenefits(current => [...current, {
      benefit_type: 'ticket', description: '', quantity: 1, estimated_value: null,
      commission_rate: null, currency: 'CLP', activation_rule: 'deliverables_completed', sales_target: null,
    }])
  }

  function updateBenefit(index: number, patch: Partial<CampaignBenefit>) {
    setBenefits(current => current.map((benefit, position) => position === index ? { ...benefit, ...patch } : benefit))
  }

  async function save() {
    if (benefits.length === 0 || benefits.some(benefit => !benefit.description.trim())) {
      toast.error('Agrega y describe al menos un beneficio')
      return
    }
    setSaving(true)
    try { await onSave(benefits) } finally { setSaving(false) }
  }

  return (
    <div className="mt-4 space-y-3">
      {benefits.map((benefit, index) => (
        <div key={index} className="rounded-xl border border-violet-100 bg-white p-3 space-y-3">
          <div className="grid gap-2 md:grid-cols-3">
            <select className={input} value={benefit.benefit_type} onChange={event => updateBenefit(index, { benefit_type: event.target.value as CampaignBenefit['benefit_type'] })}>
              {Object.entries(BARTER_BENEFIT_TYPE_CONFIG).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <input className={input} value={benefit.description} maxLength={500} onChange={event => updateBenefit(index, { description: event.target.value })} placeholder="Ej. Entrada general Maturana Sunset" />
            <input className={input} type="number" min="1" value={benefit.quantity} onChange={event => updateBenefit(index, { quantity: Math.max(1, Number(event.target.value) || 1) })} placeholder="Cantidad" />
          </div>
          <div className="grid gap-2 md:grid-cols-3">
            <select className={input} value={benefit.activation_rule} onChange={event => updateBenefit(index, { activation_rule: event.target.value as CampaignBenefit['activation_rule'], sales_target: event.target.value === 'sales_target' ? benefit.sales_target : null })}>
              <option value="deliverables_completed">Después de completar entregables</option>
              <option value="sales_target">Después de alcanzar ventas</option>
              <option value="attendance">Al asistir</option>
              <option value="accepted">Al ser aceptada</option>
              <option value="raffle">Por sorteo</option>
              <option value="manual">Confirmación de la marca</option>
            </select>
            {benefit.activation_rule === 'sales_target' && (
              <input className={input} type="number" min="1" value={benefit.sales_target ?? ''} onChange={event => updateBenefit(index, { sales_target: Math.max(1, Number(event.target.value) || 1) })} placeholder="Ventas necesarias" />
            )}
            {benefit.benefit_type === 'sales_commission' && (
              <input className={input} type="number" min="0" max="100" step="0.01" value={benefit.commission_rate ?? ''} onChange={event => updateBenefit(index, { commission_rate: Number(event.target.value) })} placeholder="Comisión %" />
            )}
            <button type="button" onClick={() => setBenefits(current => current.filter((_, position) => position !== index))} className="inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-red-500 hover:bg-red-50">
              <Trash2 className="h-3.5 w-3.5" /> Eliminar
            </button>
          </div>
        </div>
      ))}
      <button type="button" onClick={addBenefit} className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-white px-3 py-2 text-xs font-semibold text-violet-700">
        <Plus className="h-3.5 w-3.5" /> Agregar beneficio
      </button>
      <div className="flex justify-end gap-2 border-t border-violet-100 pt-3">
        <button type="button" onClick={onCancel} disabled={saving} className="rounded-lg px-3 py-2 text-xs font-semibold text-gray-500">Cancelar</button>
        <button type="button" onClick={save} disabled={saving} className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
          {saving ? 'Guardando…' : 'Guardar beneficios'}
        </button>
      </div>
    </div>
  )
}

function TrackingRow({ campaignId, barter, campaignBenefits }: { campaignId: string; barter: Barter; campaignBenefits: CampaignBenefit[] }) {
  const action = useBarterAction(campaignId)
  const benefits = effectiveBenefits(barter, campaignBenefits)

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2.5 border-b border-gray-100 px-3 py-2.5">
        <div className="h-8 w-8 rounded-full bg-gradient-to-br from-violet-400 to-pink-400 flex items-center justify-center text-white text-[10px] font-bold">
          {(barter.influencer?.display_name ?? '?').slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-gray-900">{barter.influencer?.display_name ?? 'Influencer'}</p>
          <p className="truncate text-[11px] text-gray-400">
            {barter.influencer?.email ?? 'Sin email'}
            {barter.influencer?.instagram_username ? ` · @${barter.influencer.instagram_username.replace(/^@/, '')}` : ''}
          </p>
        </div>
      </div>
      <div className="divide-y divide-gray-50 px-3">
        {benefits.map((benefit, index) => (
          <BenefitTrackingLine key={`${benefit.benefit_type}-${index}`} benefit={benefit} benefitIndex={index} barter={barter} action={action} />
        ))}
      </div>
    </div>
  )
}

function BenefitTrackingLine({ benefit, benefitIndex, barter, action }: {
  benefit: CampaignBenefit
  benefitIndex: number
  barter: Barter
  action: ReturnType<typeof useBarterAction>
}) {
  const current = getBenefitTracking(barter, benefitIndex)
  const [status, setStatus] = useState<BarterSimpleStatus>(current.status)
  const [note, setNote] = useState(current.note)

  useEffect(() => { setStatus(current.status); setNote(current.note) }, [current.note, current.status])

  async function save(nextStatus = status, nextNote = note) {
    const tracking = [...(barter.benefit_tracking ?? []).filter(row => row.benefit_index !== benefitIndex), {
      benefit_index: benefitIndex, status: nextStatus, note: nextNote.trim(),
    }].sort((a, b) => a.benefit_index - b.benefit_index)
    try {
      await action.mutateAsync({ barter_id: barter.id, patch: { benefit_tracking: tracking } })
      toast.success('Seguimiento guardado')
    } catch { /* el hook muestra el error */ }
  }

  return (
    <div className="grid gap-2 py-2 md:grid-cols-[minmax(150px,1fr)_140px_minmax(180px,1.4fr)_32px] md:items-center">
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-gray-800">{benefit.quantity}× {benefit.description}</p>
        <p className="truncate text-[10px] text-gray-400">{activationText(benefit)}</p>
      </div>
      <select value={status} onChange={event => {
        const next = event.target.value as BarterSimpleStatus
        setStatus(next)
        void save(next, note)
      }}
        className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[11px] outline-none focus:border-violet-400">
        <option value="pending">Pendiente</option>
        <option value="completed">Canje enviado</option>
        <option value="problem">Con problema</option>
      </select>
      <input value={note} maxLength={300} onChange={event => setNote(event.target.value)} onBlur={() => void save()}
        placeholder="Observación breve (opcional)"
        className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[11px] outline-none focus:border-violet-400" />
      <button type="button" onClick={() => void save()} disabled={action.isPending}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-violet-600 hover:bg-violet-50 disabled:opacity-50" title="Guardar">
        {action.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
      </button>
    </div>
  )
}

function StatusCount({ label, value, tone }: { label: string; value: number; tone: 'amber' | 'green' | 'red' }) {
  const colors = { amber: 'text-amber-600', green: 'text-emerald-600', red: 'text-red-600' }
  return <div className="card p-4"><p className="text-[11px] text-gray-500">{label}</p><p className={cn('text-xl font-bold mt-1', colors[tone])}>{value}</p></div>
}

function getSimpleStatus(barter: Barter): BarterSimpleStatus {
  if (barter.simple_status) return barter.simple_status
  if (barter.status === 'cerrado' || barter.status === 'enviado') return 'completed'
  if (barter.status === 'con_problema') return 'problem'
  return 'pending'
}

function getBenefitTracking(barter: Barter, benefitIndex: number) {
  const existing = barter.benefit_tracking?.find(row => row.benefit_index === benefitIndex)
  return existing ?? { benefit_index: benefitIndex, status: getSimpleStatus(barter), note: barter.notes ?? '' }
}

// Las campañas antiguas tenían el beneficio dentro de cada canje. No se deben
// ocultar solo porque aún no tengan campaign_benefits configurado.
function effectiveBenefits(barter: Barter, campaignBenefits: CampaignBenefit[]): CampaignBenefit[] {
  if (campaignBenefits.length > 0) return campaignBenefits
  if (barter.benefits?.length) return barter.benefits.map(benefit => ({
    benefit_type: benefit.benefit_type,
    description: benefit.description ?? barter.item,
    quantity: 1,
    estimated_value: benefit.fixed_value,
    commission_rate: benefit.commission_rate,
    currency: benefit.currency,
    activation_rule: 'manual',
    sales_target: null,
  }))
  return [{
    benefit_type: 'other', description: barter.item || 'Canje', quantity: 1,
    estimated_value: barter.estimated_value, commission_rate: null,
    currency: barter.currency, activation_rule: 'manual', sales_target: null,
  }]
}

function normalizeSearch(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

function activationText(benefit: CampaignBenefit) {
  if (benefit.activation_rule === 'sales_target') return `Pendiente: debe vender ${benefit.sales_target ?? 1} entrada(s) o producto(s).`
  if (benefit.activation_rule === 'deliverables_completed') return 'Pendiente: debe completar primero los entregables.'
  if (benefit.activation_rule === 'attendance') return 'Se entrega al asistir a la actividad.'
  if (benefit.activation_rule === 'accepted') return 'Se entrega al ser aceptada en la campaña.'
  if (benefit.activation_rule === 'raffle') return 'Se entrega según el resultado del sorteo.'
  return 'La marca confirmará cuándo corresponde enviarlo.'
}
