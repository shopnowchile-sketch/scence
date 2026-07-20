'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Gift, Plus, Check, ChevronDown, ChevronRight,
  Trash2, Loader2, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn, formatCurrency, formatDate, formatDatetime } from '@/lib/utils'
import {
  BARTER_BENEFIT_TYPE_CONFIG, BARTER_SIMPLE_STATUS_CONFIG,
  type Barter, type BarterSimpleStatus, type BarterBenefitType, type CampaignInfluencerDetail,
} from '@/types'
import {
  useCampaignBarters, useCreateBarter, useBarterAction, useDeleteBarter,
} from '@/hooks/useBarters'

interface TeamMember { user_id: string; profile: { display_name: string | null } | null }

function useTeam() {
  return useQuery({
    queryKey: ['team-members'],
    queryFn: async (): Promise<TeamMember[]> => {
      const res = await fetch('/api/settings/team')
      if (!res.ok) return []
      return (await res.json()).data ?? []
    },
  })
}

// ══════════════════════════════════════════════════════════════════════════════
export function BartersTab({
  campaignId,
  campaignInfluencers,
}: {
  campaignId: string
  campaignInfluencers: CampaignInfluencerDetail[]
}) {
  const { data: barters = [], isLoading } = useCampaignBarters(campaignId)
  const [adding, setAdding] = useState(false)

  // ── KPI simples ───────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const byStatus: Record<BarterSimpleStatus, number> = {
      pending: 0,
      completed: 0,
      problem: 0,
    }
    let totalValue = 0

    for (const barter of barters) {
      const simpleStatus = getSimpleStatus(barter)
      byStatus[simpleStatus] += 1
      totalValue += (barter.benefits ?? []).reduce(
        (sum, benefit) => sum + (benefit.fixed_value ?? 0), 0
      ) || barter.estimated_value || 0
    }

    const completionRate = barters.length
      ? Math.round((byStatus.completed / barters.length) * 100)
      : 0

    return { byStatus, totalValue, completionRate }
  }, [barters])

  return (
    <div className="space-y-5">
      {/* ── Dashboard / KPIs ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Canjes totales" value={String(barters.length)} accent="violet" />
        <KpiCard label="Valor estimado" value={formatCurrency(kpis.totalValue, 'CLP')} accent="blue" />
        <KpiCard label="Completados" value={`${kpis.byStatus.completed} · ${kpis.completionRate}%`} accent="emerald" />
        <KpiCard label="Con problema" value={String(kpis.byStatus.problem)} accent={kpis.byStatus.problem ? 'red' : 'gray'} />
      </div>

      {/* Distribución simple por estado */}
      {barters.length > 0 && (
        <div className="card p-4">
          <p className="text-xs font-semibold text-gray-500 mb-2.5">Estado de los canjes</p>
          <div className="flex flex-wrap gap-2">
            {(Object.entries(BARTER_SIMPLE_STATUS_CONFIG) as Array<
              [BarterSimpleStatus, { label: string; badge: string }]
            >).map(([status, config]) => (
              <span key={status}
                className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium',
                  kpis.byStatus[status] ? config.badge : 'bg-gray-50 text-gray-300')}>
                {config.label} <strong>{kpis.byStatus[status]}</strong>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Header + crear ────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <Gift className="h-4 w-4 text-violet-500" /> Canjes de la campaña
        </h3>
        {!adding && (
          <button onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 transition-colors">
            <Plus className="h-4 w-4" /> Nuevo canje
          </button>
        )}
      </div>

      {adding && (
        <BarterForm
          campaignId={campaignId}
          campaignInfluencers={campaignInfluencers}
          onClose={() => setAdding(false)}
        />
      )}

      {/* ── Lista ─────────────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="flex items-center justify-center py-10 text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : barters.length === 0 && !adding ? (
        <div className="card p-8 text-center">
          <Gift className="h-8 w-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">Aún no hay canjes en esta campaña.</p>
          <button onClick={() => setAdding(true)} className="mt-3 text-sm font-medium text-violet-600 hover:text-violet-700">
            + Registrar el primero
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {barters.map(b => <BarterCard key={b.id} barter={b} campaignId={campaignId} />)}
        </div>
      )}
    </div>
  )
}

// ── KPI card ────────────────────────────────────────────────────────────────
function KpiCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  const ring: Record<string, string> = {
    violet: 'text-violet-600', blue: 'text-blue-600',
    emerald: 'text-emerald-600', red: 'text-red-600', gray: 'text-gray-400',
  }
  return (
    <div className="card p-4">
      <p className="text-[11px] uppercase tracking-wide text-gray-400 font-medium">{label}</p>
      <p className={cn('text-xl font-bold mt-1', ring[accent] ?? 'text-gray-800')}>{value}</p>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
function getSimpleStatus(barter: Barter): BarterSimpleStatus {
  if (barter.simple_status) return barter.simple_status
  if (barter.status === 'cerrado') return 'completed'
  if (barter.status === 'con_problema') return 'problem'
  return 'pending'
}

function BarterCard({ barter: b, campaignId }: { barter: Barter; campaignId: string }) {
  const action = useBarterAction(campaignId)
  const del = useDeleteBarter(campaignId)
  const [showHistory, setShowHistory] = useState(false)
  const simpleStatus = getSimpleStatus(b)
  const statusConfig = BARTER_SIMPLE_STATUS_CONFIG[simpleStatus]
  const fixedValue = (b.benefits ?? []).reduce(
    (sum, benefit) => sum + (benefit.fixed_value ?? 0), 0
  ) || b.estimated_value || 0

  async function setStatus(status: BarterSimpleStatus) {
    try {
      await action.mutateAsync({ barter_id: b.id, patch: { simple_status: status } })
      toast.success(`Canje → ${BARTER_SIMPLE_STATUS_CONFIG[status].label}`)
    } catch { /* handled by hook */ }
  }

  return (
    <div className={cn('card p-4 border-l-4',
      simpleStatus === 'problem'
        ? 'border-l-red-400'
        : simpleStatus === 'completed'
          ? 'border-l-emerald-400'
          : 'border-l-violet-300')}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="h-9 w-9 rounded-full bg-gradient-to-br from-violet-400 to-pink-400 flex items-center justify-center text-white text-xs font-bold shrink-0">
            {(b.influencer?.display_name ?? '?').slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900">{b.item}</p>
            <p className="text-xs text-gray-500">
              {b.influencer?.display_name ?? 'Influencer'}
              {fixedValue > 0 ? ` · ${formatCurrency(fixedValue, b.currency)}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={cn('px-2.5 py-1 rounded-md text-xs font-semibold', statusConfig.badge)}>
            {statusConfig.label}
          </span>
          <button onClick={() => { if (confirm('¿Eliminar este canje?')) del.mutate(b.id) }}
            className="text-gray-300 hover:text-red-500 transition-colors" title="Eliminar">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {b.description && <p className="text-sm text-gray-600 mt-3">{b.description}</p>}

      <div className="mt-3 space-y-2">
        {(b.benefits ?? []).map(benefit => (
          <div key={benefit.id} className="flex items-start justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2">
            <div>
              <p className="text-xs font-semibold text-gray-700">
                {BARTER_BENEFIT_TYPE_CONFIG[benefit.benefit_type]}
              </p>
              {benefit.description && <p className="text-xs text-gray-500 mt-0.5">{benefit.description}</p>}
            </div>
            <span className="text-xs font-semibold text-gray-700 shrink-0">
              {benefit.benefit_type === 'sales_commission'
                ? `${benefit.commission_rate ?? 0}%`
                : formatCurrency(benefit.fixed_value ?? 0, benefit.currency)}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {(Object.entries(BARTER_SIMPLE_STATUS_CONFIG) as Array<
          [BarterSimpleStatus, { label: string; badge: string }]
        >).map(([status, config]) => (
          <button key={status} onClick={() => setStatus(status)}
            disabled={status === simpleStatus || action.isPending}
            className={cn('px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors',
              status === simpleStatus
                ? 'border-violet-200 bg-violet-50 text-violet-700'
                : 'border-gray-200 text-gray-600 hover:bg-gray-50',
              action.isPending && 'opacity-50')}>
            {config.label}
          </button>
        ))}
      </div>

      <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
        <span>
          {b.agreed_date ? `Fecha: ${formatDate(b.agreed_date)}` : 'Sin fecha'}
          {b.responsible?.full_name ? ` · ${b.responsible.full_name}` : ''}
        </span>
        {(b.history?.length ?? 0) > 0 && (
          <button onClick={() => setShowHistory(value => !value)}
            className="inline-flex items-center gap-1 hover:text-gray-600">
            {showHistory ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            Historial
          </button>
        )}
      </div>

      {showHistory && (
        <div className="mt-3 rounded-lg bg-gray-50 p-3 space-y-2">
          {(b.history ?? []).map(entry => (
            <div key={entry.id} className="text-xs text-gray-500">
              <span className="font-medium text-gray-700">{entry.to_status}</span>
              <span> · {formatDatetime(entry.created_at)}</span>
              {entry.note && <p className="mt-0.5">{entry.note}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
function BarterForm({
  campaignId, campaignInfluencers, onClose,
}: {
  campaignId: string
  campaignInfluencers: CampaignInfluencerDetail[]
  onClose: () => void
}) {
  const create = useCreateBarter(campaignId)
  const { data: team = [] } = useTeam()
  const { data: affiliateLinks = [] } = useQuery({
    queryKey: ['affiliate-links', campaignId],
    queryFn: async (): Promise<Array<{ id: string; name: string | null; code: string }>> => {
      const res = await fetch(`/api/affiliates?campaign_id=${campaignId}`)
      if (!res.ok) return []
      return (await res.json()).data ?? []
    },
  })
  const [f, setF] = useState({
    influencer_id: '', item: '', currency: 'CLP',
    agreed_date: '', responsible_id: '', description: '',
  })
  const [benefits, setBenefits] = useState<Array<{
    benefit_type: BarterBenefitType
    description: string
    value: string
    affiliate_link_id: string
  }>>([{
    benefit_type: 'product',
    description: '',
    value: '',
    affiliate_link_id: '',
  }])

  const influencerOpts = campaignInfluencers
    .filter(ci => ci.influencer)
    .map(ci => ({ id: ci.influencer!.id, name: ci.influencer!.display_name }))

  function updateBenefit(index: number, patch: Partial<(typeof benefits)[number]>) {
    setBenefits(current => current.map((benefit, position) =>
      position === index ? { ...benefit, ...patch } : benefit
    ))
  }

  function addBenefit() {
    setBenefits(current => [...current, {
      benefit_type: 'product',
      description: '',
      value: '',
      affiliate_link_id: '',
    }])
  }

  function removeBenefit(index: number) {
    setBenefits(current => current.filter((_, position) => position !== index))
  }

  async function submit() {
    if (!f.influencer_id || !f.item.trim()) {
      toast.error('Influencer y nombre del canje son obligatorios')
      return
    }
    if (benefits.length === 0) {
      toast.error('Agrega al menos un beneficio')
      return
    }
    if (benefits.some(benefit => !benefit.value || Number(benefit.value) < 0)) {
      toast.error('Completa el valor o porcentaje de cada beneficio')
      return
    }

    const fixedTotal = benefits.reduce((total, benefit) =>
      benefit.benefit_type === 'sales_commission' ? total : total + Number(benefit.value), 0
    )

    try {
      await create.mutateAsync({
        influencer_id: f.influencer_id,
        item: f.item.trim(),
        estimated_value: fixedTotal,
        currency: f.currency as any,
        agreed_date: f.agreed_date || null,
        responsible_id: f.responsible_id || null,
        description: f.description.trim() || null,
        benefits: benefits.map(benefit => ({
          benefit_type: benefit.benefit_type,
          description: benefit.description.trim() || null,
          fixed_value: benefit.benefit_type === 'sales_commission' ? null : Number(benefit.value),
          currency: f.currency as any,
          commission_rate: benefit.benefit_type === 'sales_commission' ? Number(benefit.value) : null,
          affiliate_link_id: benefit.benefit_type === 'sales_commission'
            ? benefit.affiliate_link_id || null
            : null,
        })),
      })
      onClose()
    } catch { /* handled by hook */ }
  }

  const input = 'w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-violet-300'

  return (
    <div className="card p-5 border border-violet-100 bg-violet-50/30">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h4 className="text-sm font-semibold text-gray-700">Nuevo canje</h4>
          <p className="text-xs text-gray-400 mt-0.5">Agrega uno o más beneficios.</p>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">Influencer *</label>
          <select value={f.influencer_id} onChange={e => setF({ ...f, influencer_id: e.target.value })} className={input}>
            <option value="">Selecciona…</option>
            {influencerOpts.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">Nombre del canje *</label>
          <input value={f.item} onChange={e => setF({ ...f, item: e.target.value })}
            placeholder="Ej: Invitación lanzamiento" className={input} />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">Fecha</label>
          <input type="date" value={f.agreed_date} onChange={e => setF({ ...f, agreed_date: e.target.value })} className={input} />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">Responsable</label>
          <select value={f.responsible_id} onChange={e => setF({ ...f, responsible_id: e.target.value })} className={input}>
            <option value="">Sin asignar</option>
            {team.map(member => (
              <option key={member.user_id} value={member.user_id}>
                {member.profile?.display_name ?? member.user_id.slice(0, 8)}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="text-xs font-medium text-gray-500 mb-1 block">Descripción general</label>
          <textarea value={f.description} onChange={e => setF({ ...f, description: e.target.value })}
            rows={3} maxLength={2000} className={input}
            placeholder="Acuerdo, condiciones o información importante…" />
          <p className="text-[11px] text-gray-400 text-right mt-1">{f.description.length}/2000</p>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        <div className="flex items-center justify-between">
          <h5 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Beneficios</h5>
          <button type="button" onClick={addBenefit}
            className="inline-flex items-center gap-1 text-xs font-semibold text-violet-600 hover:text-violet-700">
            <Plus className="h-3.5 w-3.5" /> Agregar beneficio
          </button>
        </div>

        {benefits.map((benefit, index) => {
          const isCommission = benefit.benefit_type === 'sales_commission'
          return (
            <div key={index} className="rounded-xl border border-gray-200 bg-white p-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Tipo *</label>
                  <select value={benefit.benefit_type}
                    onChange={e => updateBenefit(index, {
                      benefit_type: e.target.value as BarterBenefitType,
                      value: '',
                      affiliate_link_id: '',
                    })}
                    className={input}>
                    {(Object.entries(BARTER_BENEFIT_TYPE_CONFIG) as Array<[BarterBenefitType, string]>)
                      .map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">
                    {isCommission ? 'Comisión (%) *' : 'Valor *'}
                  </label>
                  <div className="flex gap-2">
                    <input type="number" min="0" max={isCommission ? 100 : undefined}
                      step={isCommission ? '0.01' : '1'}
                      value={benefit.value}
                      onChange={e => updateBenefit(index, { value: e.target.value })}
                      placeholder={isCommission ? '5' : '0'} className={input} />
                    {!isCommission && (
                      <select value={f.currency} onChange={e => setF({ ...f, currency: e.target.value })}
                        className={cn(input, 'w-24')}>
                        {['CLP', 'USD', 'EUR', 'MXN', 'COP', 'ARS', 'BRL'].map(currency =>
                          <option key={currency} value={currency}>{currency}</option>
                        )}
                      </select>
                    )}
                  </div>
                </div>
                <div className={cn('sm:col-span-2', isCommission && 'sm:col-span-1')}>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Descripción</label>
                  <input value={benefit.description}
                    onChange={e => updateBenefit(index, { description: e.target.value })}
                    maxLength={500} placeholder="Detalle del beneficio" className={input} />
                </div>
                {isCommission && (
                  <div>
                    <label className="text-xs font-medium text-gray-500 mb-1 block">Link de afiliado</label>
                    <select value={benefit.affiliate_link_id}
                      onChange={e => updateBenefit(index, { affiliate_link_id: e.target.value })}
                      className={input}>
                      <option value="">Vincular después</option>
                      {affiliateLinks.map(link => (
                        <option key={link.id} value={link.id}>{link.name || link.code}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              {benefits.length > 1 && (
                <div className="flex justify-end mt-2">
                  <button type="button" onClick={() => removeBenefit(index)}
                    className="inline-flex items-center gap-1 text-xs text-red-500 hover:text-red-600">
                    <Trash2 className="h-3.5 w-3.5" /> Quitar
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">Cancelar</button>
        <button onClick={submit} disabled={create.isPending}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 disabled:opacity-50">
          {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Crear canje
        </button>
      </div>
    </div>
  )
}
