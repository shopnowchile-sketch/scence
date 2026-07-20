'use client'

import { useEffect, useMemo, useState } from 'react'
import { Gift, Loader2, Mail, AlertTriangle, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn, formatCurrency } from '@/lib/utils'
import {
  BARTER_BENEFIT_TYPE_CONFIG,
  BARTER_SIMPLE_STATUS_CONFIG,
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

  useEffect(() => {
    if (!isLoading && campaignBenefits.length > 0 && acceptedCount > barters.length && !initialize.isPending && !initialize.isSuccess) {
      initialize.mutate()
    }
  }, [acceptedCount, barters.length, campaignBenefits.length, initialize, isLoading])

  const counts = useMemo(() => {
    const result: Record<BarterSimpleStatus, number> = { pending: 0, completed: 0, problem: 0 }
    for (const barter of barters) result[getSimpleStatus(barter)] += 1
    return result
  }, [barters])

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

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">Seguimiento por influencer</h3>
          <p className="text-xs text-gray-500 mt-1">Aquí solo se registra si el canje sigue pendiente, fue enviado o tuvo un problema.</p>
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
          barters.map(barter => <TrackingRow key={barter.id} campaignId={campaignId} barter={barter} />)
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

function TrackingRow({ campaignId, barter }: { campaignId: string; barter: Barter }) {
  const action = useBarterAction(campaignId)
  const status = getSimpleStatus(barter)

  async function setStatus(next: BarterSimpleStatus) {
    try {
      await action.mutateAsync({ barter_id: barter.id, patch: { simple_status: next } })
      toast.success(BARTER_SIMPLE_STATUS_CONFIG[next].label)
    } catch { /* el hook muestra el error */ }
  }

  return (
    <div className="card p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-full bg-gradient-to-br from-violet-400 to-pink-400 flex items-center justify-center text-white text-xs font-bold">
          {(barter.influencer?.display_name ?? '?').slice(0, 2).toUpperCase()}
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-900">{barter.influencer?.display_name ?? 'Influencer'}</p>
          <p className="text-xs text-gray-500">
            {status === 'pending' ? 'Debe cumplir primero las condiciones indicadas.' : status === 'completed' ? 'Canje enviado por correo o entregado.' : 'Requiere revisión.'}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <SimpleStatusButton active={status === 'pending'} disabled={action.isPending} onClick={() => setStatus('pending')}>
          Pendiente
        </SimpleStatusButton>
        <SimpleStatusButton active={status === 'completed'} disabled={action.isPending} onClick={() => setStatus('completed')} icon={<Mail className="h-3.5 w-3.5" />}>
          Canje enviado
        </SimpleStatusButton>
        <SimpleStatusButton active={status === 'problem'} disabled={action.isPending} onClick={() => setStatus('problem')} icon={<AlertTriangle className="h-3.5 w-3.5" />}>
          Con problema
        </SimpleStatusButton>
      </div>
    </div>
  )
}

function SimpleStatusButton({ active, disabled, onClick, icon, children }: {
  active: boolean
  disabled: boolean
  onClick: () => void
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button type="button" disabled={disabled || active} onClick={onClick}
      className={cn('inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors',
        active ? 'border-violet-200 bg-violet-50 text-violet-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50',
        disabled && 'opacity-50')}>
      {icon}{children}
    </button>
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

function activationText(benefit: CampaignBenefit) {
  if (benefit.activation_rule === 'sales_target') return `Pendiente: debe vender ${benefit.sales_target ?? 1} entrada(s) o producto(s).`
  if (benefit.activation_rule === 'deliverables_completed') return 'Pendiente: debe completar primero los entregables.'
  if (benefit.activation_rule === 'attendance') return 'Se entrega al asistir a la actividad.'
  if (benefit.activation_rule === 'accepted') return 'Se entrega al ser aceptada en la campaña.'
  if (benefit.activation_rule === 'raffle') return 'Se entrega según el resultado del sorteo.'
  return 'La marca confirmará cuándo corresponde enviarlo.'
}
