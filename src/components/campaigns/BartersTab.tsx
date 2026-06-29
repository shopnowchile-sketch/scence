'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Gift, Plus, Check, AlertTriangle, RotateCcw, ChevronDown, ChevronRight,
  Clock, ExternalLink, Trash2, Loader2, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn, formatCurrency, formatDate, formatDatetime } from '@/lib/utils'
import {
  BARTER_FLOW, BARTER_STATUS_CONFIG,
  type Barter, type BarterStatus, type CampaignInfluencerDetail,
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

  // ── KPIs ────────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const byStatus = {} as Record<BarterStatus, number>
    let totalValue = 0
    let closed = 0
    for (const b of barters) {
      byStatus[b.status] = (byStatus[b.status] ?? 0) + 1
      totalValue += b.estimated_value ?? 0
      if (b.status === 'cerrado') closed += 1
    }
    const problems = byStatus['con_problema'] ?? 0
    const pct = barters.length ? Math.round((closed / barters.length) * 100) : 0
    return { byStatus, totalValue, closed, problems, pct }
  }, [barters])

  return (
    <div className="space-y-5">
      {/* ── Dashboard / KPIs ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Canjes totales" value={String(barters.length)} accent="violet" />
        <KpiCard label="Valor estimado" value={formatCurrency(kpis.totalValue, 'CLP')} accent="blue" />
        <KpiCard label="Cerrados" value={`${kpis.closed} · ${kpis.pct}%`} accent="emerald" />
        <KpiCard label="Con problema" value={String(kpis.problems)} accent={kpis.problems ? 'red' : 'gray'} />
      </div>

      {/* Distribución por estado */}
      {barters.length > 0 && (
        <div className="card p-4">
          <p className="text-xs font-semibold text-gray-500 mb-2.5">Distribución por estado</p>
          <div className="flex flex-wrap gap-1.5">
            {BARTER_FLOW.concat('con_problema').map(s => {
              const n = kpis.byStatus[s as BarterStatus] ?? 0
              const cfg = BARTER_STATUS_CONFIG[s as BarterStatus]
              return (
                <span key={s}
                  className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium',
                    n ? cfg.badge : 'bg-gray-50 text-gray-300')}>
                  {cfg.short} <strong>{n}</strong>
                </span>
              )
            })}
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
function BarterCard({ barter: b, campaignId }: { barter: Barter; campaignId: string }) {
  const action = useBarterAction(campaignId)
  const del = useDeleteBarter(campaignId)
  const [showHistory, setShowHistory] = useState(false)
  const [evidence, setEvidence] = useState(b.evidence_url ?? '')

  const cfg = BARTER_STATUS_CONFIG[b.status]
  const flowIdx = BARTER_FLOW.indexOf(b.status)
  const isProblem = b.status === 'con_problema'
  const isClosed = b.status === 'cerrado'
  const nextStatus: BarterStatus | null =
    flowIdx >= 0 && flowIdx < BARTER_FLOW.length - 1 ? BARTER_FLOW[flowIdx + 1] : null

  async function advance(to: BarterStatus, note?: string) {
    try {
      await action.mutateAsync({ barter_id: b.id, status: to, note, evidence_url: evidence || undefined })
      toast.success(`Canje → ${BARTER_STATUS_CONFIG[to].label}`)
    } catch { /* handled */ }
  }

  return (
    <div className={cn('card p-4 border-l-4',
      isProblem ? 'border-l-red-400' : isClosed ? 'border-l-emerald-400' : 'border-l-violet-300')}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="h-9 w-9 rounded-full bg-gradient-to-br from-violet-400 to-pink-400 flex items-center justify-center text-white text-xs font-bold shrink-0">
            {(b.influencer?.display_name ?? '?').slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{b.item}</p>
            <p className="text-xs text-gray-500">
              {b.influencer?.display_name ?? 'Influencer'}
              {b.brand?.name ? ` · ${b.brand.name}` : ''}
              {b.estimated_value ? ` · ${formatCurrency(b.estimated_value, b.currency)}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={cn('px-2.5 py-1 rounded-md text-xs font-semibold', cfg.badge)}>{cfg.label}</span>
          <button onClick={() => { if (confirm('¿Eliminar este canje?')) del.mutate(b.id) }}
            className="text-gray-300 hover:text-red-500 transition-colors" title="Eliminar">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Timeline stepper */}
      <div className="mt-4">
        <div className="flex items-center">
          {BARTER_FLOW.map((s, i) => {
            const done = !isProblem && flowIdx >= i
            const current = !isProblem && flowIdx === i
            return (
              <div key={s} className="flex items-center flex-1 last:flex-none">
                <div className="flex flex-col items-center">
                  <div className={cn('h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold transition-colors',
                    done ? 'bg-violet-600 text-white' : 'bg-gray-200 text-gray-400',
                    current && 'ring-2 ring-violet-200')}>
                    {done ? <Check className="h-3 w-3" /> : i + 1}
                  </div>
                  <span className={cn('mt-1 text-[9px] text-center leading-tight w-12',
                    done ? 'text-violet-700 font-medium' : 'text-gray-400')}>
                    {BARTER_STATUS_CONFIG[s].short}
                  </span>
                </div>
                {i < BARTER_FLOW.length - 1 && (
                  <div className={cn('h-0.5 flex-1 -mt-4', flowIdx > i && !isProblem ? 'bg-violet-600' : 'bg-gray-200')} />
                )}
              </div>
            )
          })}
        </div>
        {isProblem && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-red-600 font-medium">
            <AlertTriangle className="h-3.5 w-3.5" /> Este canje está marcado con problema.
          </div>
        )}
      </div>

      {/* Evidencia */}
      <div className="mt-4 flex items-center gap-2">
        <input
          value={evidence}
          onChange={e => setEvidence(e.target.value)}
          placeholder="URL de evidencia (post, foto, tracking…)"
          className="flex-1 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-300"
        />
        {b.evidence_url && (
          <a href={b.evidence_url} target="_blank" rel="noopener noreferrer"
            className="text-violet-600 hover:text-violet-700" title="Abrir evidencia">
            <ExternalLink className="h-4 w-4" />
          </a>
        )}
      </div>

      {/* Acciones */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {nextStatus && !isProblem && (
          <button onClick={() => advance(nextStatus)} disabled={action.isPending}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 text-white text-xs font-medium rounded-lg hover:bg-violet-700 disabled:opacity-50">
            {action.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronRight className="h-3.5 w-3.5" />}
            Avanzar a “{BARTER_STATUS_CONFIG[nextStatus].label}”
          </button>
        )}
        {!isProblem && !isClosed && (
          <button onClick={() => { const note = prompt('Describe el problema (opcional):') ?? undefined; advance('con_problema', note) }}
            disabled={action.isPending}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-600 text-xs font-medium rounded-lg hover:bg-red-100 disabled:opacity-50">
            <AlertTriangle className="h-3.5 w-3.5" /> Marcar problema
          </button>
        )}
        {isProblem && (
          <button onClick={() => advance(flowIdx >= 0 ? BARTER_FLOW[Math.max(0, flowIdx)] : 'pactado')}
            disabled={action.isPending}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-200 disabled:opacity-50">
            <RotateCcw className="h-3.5 w-3.5" /> Reabrir
          </button>
        )}
        <button onClick={() => setShowHistory(v => !v)}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700">
          {showHistory ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          Historial ({b.history?.length ?? 0})
        </button>
      </div>

      {/* Historial */}
      {showHistory && (
        <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
          {(b.history ?? []).length === 0 && (
            <p className="text-xs text-gray-400">Sin movimientos registrados.</p>
          )}
          {(b.history ?? []).map(h => (
            <div key={h.id} className="flex items-start gap-2 text-xs">
              <Clock className="h-3.5 w-3.5 text-gray-300 mt-0.5 shrink-0" />
              <div>
                <span className="text-gray-700 font-medium">
                  {h.from_status ? `${BARTER_STATUS_CONFIG[h.from_status].label} → ` : ''}
                  {BARTER_STATUS_CONFIG[h.to_status].label}
                </span>
                <span className="text-gray-400">
                  {' · '}{formatDatetime(h.created_at)}
                  {h.actor?.full_name ? ` · ${h.actor.full_name}` : ''}
                </span>
                {h.note && <p className="text-gray-500 mt-0.5">“{h.note}”</p>}
              </div>
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
  const [f, setF] = useState({
    influencer_id: '', item: '', estimated_value: '', currency: 'CLP',
    agreed_date: '', responsible_id: '', description: '',
  })

  const influencerOpts = campaignInfluencers
    .filter(ci => ci.influencer)
    .map(ci => ({ id: ci.influencer!.id, name: ci.influencer!.display_name }))

  async function submit() {
    if (!f.influencer_id || !f.item.trim()) {
      toast.error('Influencer e ítem son obligatorios')
      return
    }
    try {
      await create.mutateAsync({
        influencer_id:   f.influencer_id,
        item:            f.item.trim(),
        estimated_value: f.estimated_value ? Number(f.estimated_value) : null,
        currency:        f.currency as any,
        agreed_date:     f.agreed_date || null,
        responsible_id:  f.responsible_id || null,
        description:     f.description || null,
      })
      onClose()
    } catch { /* handled */ }
  }

  const input = 'w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-violet-300'

  return (
    <div className="card p-5 border border-violet-100 bg-violet-50/30">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-sm font-semibold text-gray-700">Nuevo canje</h4>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">Influencer *</label>
          <select value={f.influencer_id} onChange={e => setF({ ...f, influencer_id: e.target.value })} className={input}>
            <option value="">Selecciona…</option>
            {influencerOpts.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">Ítem / producto *</label>
          <input value={f.item} onChange={e => setF({ ...f, item: e.target.value })} placeholder="Ej: Set skincare premium" className={input} />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">Valor estimado</label>
          <div className="flex gap-2">
            <input type="number" value={f.estimated_value} onChange={e => setF({ ...f, estimated_value: e.target.value })} placeholder="0" className={input} />
            <select value={f.currency} onChange={e => setF({ ...f, currency: e.target.value })} className={cn(input, 'w-24')}>
              {['CLP', 'USD', 'EUR', 'MXN', 'COP', 'ARS', 'BRL'].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">Fecha pactada</label>
          <input type="date" value={f.agreed_date} onChange={e => setF({ ...f, agreed_date: e.target.value })} className={input} />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">Responsable</label>
          <select value={f.responsible_id} onChange={e => setF({ ...f, responsible_id: e.target.value })} className={input}>
            <option value="">Sin asignar</option>
            {team.map(m => (
              <option key={m.user_id} value={m.user_id}>{m.profile?.display_name ?? m.user_id.slice(0, 8)}</option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="text-xs font-medium text-gray-500 mb-1 block">Descripción / notas</label>
          <textarea value={f.description} onChange={e => setF({ ...f, description: e.target.value })} rows={2} className={input} />
        </div>
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
