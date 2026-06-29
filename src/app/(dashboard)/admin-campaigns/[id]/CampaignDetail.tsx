'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, Target, Calendar, DollarSign, Users, FileText,
  BarChart3, ExternalLink, CheckCircle2,
  XCircle, Clock, Pencil, Play, Pause, Check, AlertCircle, Loader2, Trash2, Plus, FileDown, Gift,
} from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { cn, formatCurrency, formatDate, PLATFORM_ICONS } from '@/lib/utils'
import { CampaignStatusBadge } from '@/components/campaigns/CampaignStatusBadge'
import { BartersTab } from '@/components/campaigns/BartersTab'
import type { CampaignDetail, CampaignDeliverableDetail, DeliverableStatus } from '@/types'
import { useCampaignDetail, usePatchCampaign, useDeliverableAction, useRemoveCampaignInfluencer } from '@/hooks/useCampaignsList'
import { toast } from 'sonner'

// ── Deliverable status config ────────────────────────────────────────────────
const DEL_CONFIG: Record<DeliverableStatus, { label: string; cls: string; icon: React.ReactNode }> = {
  pending:    { label: 'Pendiente',   cls: 'badge-gray',   icon: <Clock className="h-3 w-3" /> },
  in_review:  { label: 'En revisión', cls: 'badge-orange', icon: <Clock className="h-3 w-3" /> },
  approved:   { label: 'Aprobado',    cls: 'badge-blue',   icon: <CheckCircle2 className="h-3 w-3" /> },
  rejected:   { label: 'Rechazado',   cls: 'badge-red',    icon: <XCircle className="h-3 w-3" /> },
  published:  { label: 'Publicado',   cls: 'badge-green',  icon: <CheckCircle2 className="h-3 w-3" /> },
}

const GRADIENTS = [
  'from-pink-400 to-violet-500', 'from-blue-400 to-cyan-500',
  'from-emerald-400 to-teal-500', 'from-orange-400 to-red-500',
  'from-amber-400 to-orange-500', 'from-violet-400 to-indigo-500',
]

type Tab = 'overview' | 'influencers' | 'deliverables' | 'canjes' | 'history'

// ── Deliverable card ─────────────────────────────────────────────────────────
function DeliverableCard({
  d, campaignId, reviewNotes, setReviewNotes,
}: {
  d: CampaignDeliverableDetail
  campaignId: string
  reviewNotes: Record<string, string>
  setReviewNotes: React.Dispatch<React.SetStateAction<Record<string, string>>>
}) {
  const action = useDeliverableAction(campaignId)
  const cfg = DEL_CONFIG[d.status] ?? DEL_CONFIG.pending

  async function handle(act: 'approve' | 'reject') {
    try {
      await action.mutateAsync({
        deliverable_id: d.id,
        action: act === 'approve' ? 'approve' : 'reject',
        review_notes: reviewNotes[d.id] ?? undefined,
      })
      toast.success(act === 'approve' ? 'Contenido aprobado ✓' : 'Contenido rechazado')
    } catch { /* handled in hook */ }
  }

  async function handleProgress(pct: number) {
    try {
      await action.mutateAsync({
        deliverable_id: d.id,
        action: 'update_progress' as never,
        progress: pct,
      } as never)
      toast.success(`Progreso actualizado a ${pct}%`)
    } catch { /* handled in hook */ }
  }

  return (
    <div className={cn(
      'card p-4 border-l-4 transition-all',
      d.status === 'in_review' ? 'border-l-amber-400' :
      d.status === 'approved'  ? 'border-l-blue-400' :
      d.status === 'published' ? 'border-l-emerald-400' :
      d.status === 'rejected'  ? 'border-l-red-400' : 'border-l-gray-200'
    )}>
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-sm font-semibold text-gray-900">
              {d.platform && PLATFORM_ICONS[d.platform] ? <>{PLATFORM_ICONS[d.platform]}{' '}</> : null}
              {d.title}
            </span>
            <span className={cn('badge text-[11px] flex items-center gap-1', cfg.cls)}>
              {cfg.icon} {cfg.label}
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-400 flex-wrap">
            {d.influencer && <span>👤 {d.influencer.display_name}</span>}
            {d.type && <span className="badge badge-gray text-[10px] capitalize">{d.type.replace(/_/g, ' ')}</span>}
            {d.due_date && (
              <span className={cn(
                'flex items-center gap-1',
                new Date(d.due_date) < new Date() && d.status === 'pending' ? 'text-red-500 font-medium' : ''
              )}>
                <Calendar className="h-3 w-3" />
                Entrega: {formatDate(d.due_date)}
              </span>
            )}
            {d.published_at && (
              <span className="text-emerald-600 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Publicado {formatDate(d.published_at)}
              </span>
            )}
            {d.published_url && (
              <a href={d.published_url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-violet-600 hover:underline">
                <ExternalLink className="h-3 w-3" /> Ver publicación
              </a>
            )}
            {!d.published_url && d.content_url && (
              <a href={d.content_url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-amber-600 hover:underline">
                <ExternalLink className="h-3 w-3" /> Ver contenido enviado
              </a>
            )}
          </div>
          {/* Progress selector */}
          {d.status !== 'published' && d.status !== 'approved' && (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-xs text-gray-400">Progreso:</span>
              {[0, 25, 50, 75, 100].map(pct => {
                const currentProg = d.progress ?? 0
                return (
                  <button key={pct} type="button"
                    disabled={action.isPending}
                    onClick={() => handleProgress(pct)}
                    className={cn(
                      'text-xs font-semibold px-2 py-0.5 rounded-full border transition-all',
                      currentProg === pct
                        ? 'border-violet-500 bg-violet-100 text-violet-700'
                        : 'border-gray-200 text-gray-400 hover:border-violet-300 hover:text-violet-600'
                    )}>
                    {pct}%
                  </button>
                )
              })}
            </div>
          )}

          {d.review_notes && (
            <div className={cn(
              'mt-2 text-xs rounded-lg px-3 py-2',
              d.status === 'rejected' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'
            )}>
              💬 {d.review_notes}
            </div>
          )}
        </div>

        {d.status === 'in_review' && (
          <div className="flex flex-col gap-2 flex-shrink-0 min-w-[200px]">
            <textarea
              placeholder="Notas de revisión (opcional)..."
              value={reviewNotes[d.id] ?? ''}
              onChange={e => setReviewNotes(prev => ({ ...prev, [d.id]: e.target.value }))}
              className="input-base text-xs resize-none h-16"
            />
            <div className="flex gap-2">
              <button onClick={() => handle('reject')} disabled={action.isPending}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50 transition-colors">
                <XCircle className="h-3.5 w-3.5" /> Rechazar
              </button>
              <button onClick={() => handle('approve')} disabled={action.isPending}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold text-white bg-violet-600 rounded-lg hover:bg-violet-700 disabled:opacity-50 transition-colors">
                <CheckCircle2 className="h-3.5 w-3.5" /> Aprobar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────
// ── TimelineItem ──────────────────────────────────────────────────────────────
function TimelineItem({ icon, color, title, date, desc }: {
  icon: string; color: string; title: string; date: string; desc: string
}) {
  const colors: Record<string, string> = {
    violet: 'bg-violet-100', emerald: 'bg-emerald-100', blue: 'bg-blue-100',
    red: 'bg-red-100', amber: 'bg-amber-100', gray: 'bg-gray-100'
  }
  return (
    <div className="flex gap-3 pb-4 relative">
      <div className="flex flex-col items-center flex-shrink-0">
        <div className={`w-8 h-8 rounded-full ${colors[color] ?? 'bg-gray-100'} flex items-center justify-center text-sm z-10`}>
          {icon}
        </div>
        <div className="w-px flex-1 bg-gray-100 mt-1" />
      </div>
      <div className="flex-1 pb-1">
        <p className="text-sm font-medium text-gray-800">{title}</p>
        <div className="flex items-center gap-2 mt-0.5">
          {date && <span className="text-xs text-gray-400">{formatDate(date, "d MMM yyyy 'a las' HH:mm")}</span>}
          {desc && <span className="text-xs text-gray-400">· {desc}</span>}
        </div>
      </div>
    </div>
  )
}

// ── AddDeliverableForm ────────────────────────────────────────────────────────
const DELIVERABLE_TYPE_OPTIONS = [
  { value: 'reel',             label: '🎬 Reel' },
  { value: 'story',            label: '📸 Stories' },
  { value: 'post',             label: '🖼️ Post / Feed' },
  { value: 'live',             label: '🔴 Live' },
  { value: 'event_attendance', label: '📅 Confirmar asistencia' },
  { value: 'event_checkin',    label: '✅ Check-in evento' },
  { value: 'send_content',     label: '📤 Enviar contenido' },
  { value: 'ugc_video',        label: '📹 Video UGC' },
  { value: 'blog_post',        label: '✍️ Blog / Artículo' },
]

function AddDeliverableForm({
  campaignId, influencers, onSuccess, onCancel,
}: {
  campaignId: string
  influencers: Array<{ id: string; name: string }>
  onSuccess: () => void
  onCancel: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    influencer_id: influencers[0]?.id ?? '',
    type: 'reel',
    title: '',
    description: '',
    due_date: '',
    quantity: 1,
  })

  function f(key: string, val: unknown) { setForm(p => ({ ...p, [key]: val })) }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.influencer_id || !form.type) return
    setSaving(true)
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/deliverables`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          influencer_id: form.influencer_id,
          type:          form.type,
          title:         form.title || DELIVERABLE_TYPE_OPTIONS.find(o => o.value === form.type)?.label.replace(/^.+ /, '') || form.type,
          description:   form.description || null,
          due_date:      form.due_date || null,
          quantity:      form.quantity,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Error al crear deliverable')
      toast.success('Deliverable creado ✓')
      onSuccess()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card p-4 border border-violet-200 bg-violet-50/30 space-y-3">
      <p className="text-sm font-semibold text-violet-700">Nuevo deliverable</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Influencer *</label>
          <select value={form.influencer_id} onChange={e => f('influencer_id', e.target.value)}
            className="input-base w-full text-sm py-1.5" required>
            {influencers.map(inf => <option key={inf.id} value={inf.id}>{inf.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Tipo *</label>
          <select value={form.type} onChange={e => f('type', e.target.value)}
            className="input-base w-full text-sm py-1.5" required>
            {DELIVERABLE_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Título (opcional)</label>
          <input type="text" value={form.title} onChange={e => f('title', e.target.value)}
            placeholder="Ej. Reel lanzamiento producto"
            className="input-base w-full text-sm py-1.5" />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Fecha límite</label>
          <input type="date" value={form.due_date} onChange={e => f('due_date', e.target.value)}
            className="input-base w-full text-sm py-1.5" />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Cantidad</label>
          <input type="number" min={1} max={20} value={form.quantity} onChange={e => f('quantity', parseInt(e.target.value) || 1)}
            className="input-base w-full text-sm py-1.5" />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Descripción / instrucciones</label>
          <input type="text" value={form.description} onChange={e => f('description', e.target.value)}
            placeholder="Instrucciones para el influencer"
            className="input-base w-full text-sm py-1.5" />
        </div>
      </div>
      <div className="flex gap-2 justify-end pt-1">
        <button type="button" onClick={onCancel}
          className="px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
          Cancelar
        </button>
        <button type="submit" disabled={saving || !form.influencer_id}
          className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50 transition-colors">
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          {saving ? 'Guardando…' : 'Crear deliverable'}
        </button>
      </div>
    </form>
  )
}

export function CampaignDetail({ id, defaultTab }: { id: string; defaultTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(defaultTab ?? 'overview')
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({})
  const [addingDeliverable, setAddingDeliverable] = useState(false)

  const { data: res, isLoading, error, refetch } = useCampaignDetail(id)
  const patchCampaign = usePatchCampaign(id)
  const removeInfluencer = useRemoveCampaignInfluencer(id)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 text-violet-400 animate-spin" />
      </div>
    )
  }

  if (error || !res?.data) {
    return (
      <div className="card p-12 text-center max-w-lg mx-auto mt-12">
        <AlertCircle className="h-10 w-10 text-red-300 mx-auto mb-3" />
        <p className="text-gray-500 font-medium">Campaña no encontrada</p>
        <Link href="/admin-campaigns" className="mt-4 inline-block text-sm text-violet-600 hover:underline">
          Volver a campañas
        </Link>
      </div>
    )
  }

  const c = res.data as CampaignDetail
  const campaignInfluencers     = c.campaign_influencers ?? []
  const confirmedInfluencers    = campaignInfluencers.filter(ci => ci.status !== 'applied')
  const campaignDeliverables = c.campaign_deliverables ?? []

  const deliverableCount = campaignDeliverables.length
  const deliverableDone  = campaignDeliverables.filter(d => d.status === 'published').length
  // Average progress: published=100, others use progress field
  const avgProgress = deliverableCount > 0
    ? Math.round(campaignDeliverables.reduce((sum, d) => {
        if (d.status === 'published') return sum + 100
        return sum + (d.progress ?? 0)
      }, 0) / deliverableCount)
    : 0
  const pct = avgProgress
  const budgetPct = c.budget_total ? Math.round((c.budget_spent / c.budget_total) * 100) : 0

  async function handleStatusAction(action: string) {
    try {
      await patchCampaign.mutateAsync({ action })
      toast.success('Estado actualizado')
    } catch { /* handled in hook */ }
  }

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'overview',     label: 'Overview',      icon: <Target className="h-4 w-4" /> },
    { id: 'influencers',  label: `Influencers (${campaignInfluencers.length})`, icon: <Users className="h-4 w-4" /> },
    { id: 'deliverables', label: `Deliverables (${deliverableCount})`,           icon: <CheckCircle2 className="h-4 w-4" /> },
    { id: 'canjes',       label: 'Canjes',        icon: <Gift className="h-4 w-4" /> },
    { id: 'history',      label: 'Historial',     icon: <Clock className="h-4 w-4" /> },
  ]

  return (
    <div className="space-y-5">
      {/* Breadcrumb + actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/admin-campaigns" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
            <ArrowLeft className="h-4 w-4" /> Campañas
          </Link>
          <span className="text-gray-200">/</span>
          <span className="text-sm font-semibold text-gray-800 truncate max-w-[240px]">{c.name}</span>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/campaigns/${id}/report`} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-violet-700 bg-violet-50 border border-violet-200 rounded-lg hover:bg-violet-100 transition-colors">
            <FileDown className="h-3.5 w-3.5" /> Reporte PDF
          </Link>
          <Link href={`/campaigns/${id}/edit`}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
            <Pencil className="h-3.5 w-3.5" /> Editar
          </Link>
          {c.status === 'draft' && (
            <button onClick={() => handleStatusAction('submit_for_approval')} disabled={patchCampaign.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-violet-700 bg-violet-50 border border-violet-200 rounded-lg hover:bg-violet-100 disabled:opacity-50 transition-colors">
              <Check className="h-3.5 w-3.5" /> Enviar a aprobación
            </button>
          )}
          {(c.status === 'pending_approval' || c.status === 'paused') && (
            <button onClick={() => handleStatusAction('activate')} disabled={patchCampaign.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 disabled:opacity-50 transition-colors">
              <Play className="h-3.5 w-3.5" /> {c.status === 'paused' ? 'Reactivar' : 'Activar'}
            </button>
          )}
          {c.status === 'active' && (
            <>
              <button onClick={() => handleStatusAction('pause')} disabled={patchCampaign.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 disabled:opacity-50 transition-colors">
                <Pause className="h-3.5 w-3.5" /> Pausar
              </button>
              <button onClick={() => handleStatusAction('complete')} disabled={patchCampaign.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-violet-600 rounded-lg hover:bg-violet-700 disabled:opacity-50 transition-colors">
                <Check className="h-3.5 w-3.5" /> Marcar completada
              </button>
            </>
          )}
          {c.status === 'completed' && (
            <button onClick={() => handleStatusAction('activate')} disabled={patchCampaign.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-violet-700 bg-violet-50 border border-violet-200 rounded-lg hover:bg-violet-100 disabled:opacity-50 transition-colors">
              <Play className="h-3.5 w-3.5" /> Reabrir campaña
            </button>
          )}
        </div>
      </div>

      {/* Header card */}
      <div className="card p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-violet-100 flex items-center justify-center flex-shrink-0">
            <Target className="h-6 w-6 text-violet-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap mb-1">
              <h1 className="text-xl font-bold text-gray-900 tracking-tight">{c.name}</h1>
              <CampaignStatusBadge status={c.status} />
              <span className="badge badge-gray capitalize text-[11px]">{c.type.replace(/_/g, ' ')}</span>
            </div>
            {c.description && <p className="text-sm text-gray-500 mb-3">{c.description}</p>}
            <div className="flex items-center gap-5 flex-wrap text-sm text-gray-500">
              {c.start_date && (
                <div className="flex items-center gap-1.5">
                  <Calendar className="h-4 w-4 text-gray-300" />
                  <span>{formatDate(c.start_date)} → {c.end_date ? formatDate(c.end_date) : '—'}</span>
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <DollarSign className="h-4 w-4 text-gray-300" />
                <span>Budget: <strong className="text-gray-800">{formatCurrency(c.budget_total ?? 0, c.currency)}</strong></span>
              </div>
              <div className="flex items-center gap-1.5">
                <Users className="h-4 w-4 text-gray-300" />
                <span><strong className="text-gray-800">{campaignInfluencers.length}</strong> influencers</span>
              </div>
              {c.brief_url && (
                <a href={c.brief_url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 text-violet-600 hover:underline">
                  <FileText className="h-4 w-4" /> Ver brief
                </a>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 flex-shrink-0">
            <div className="text-center bg-gray-50 rounded-xl p-3 min-w-[80px]">
              <div className="text-2xl font-bold text-gray-900">{pct}%</div>
              <div className="text-[11px] text-gray-400">Completado</div>
            </div>
            <div className="text-center bg-gray-50 rounded-xl p-3 min-w-[80px]">
              <div className="text-2xl font-bold text-gray-900">{budgetPct}%</div>
              <div className="text-[11px] text-gray-400">Budget usado</div>
            </div>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-gray-100">
          <div className="flex justify-between text-xs text-gray-400 mb-1.5">
            <span>{deliverableDone}/{deliverableCount} deliverables publicados</span>
            <span>{formatCurrency(c.budget_spent, c.currency)} gastados de {formatCurrency(c.budget_total ?? 0, c.currency)}</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className={cn('h-full rounded-full transition-all', pct === 100 ? 'bg-emerald-500' : 'bg-violet-500')}
              style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <div className="flex gap-1">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-all -mb-px',
                tab === t.id ? 'border-violet-600 text-violet-700' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              )}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── OVERVIEW ───────────────────────────────────────────────────────── */}
      {tab === 'overview' && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          <div className="col-span-2 space-y-4">
            {c.goals && Object.keys(c.goals).length > 0 && (
              <div className="card p-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-violet-500" /> Objetivos de campaña
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {Object.entries(c.goals).map(([key, val]) => (
                    <div key={key} className="bg-gray-50 rounded-xl p-3 text-center">
                      <div className="text-xl font-bold text-gray-900">
                        {typeof val === 'number' && val >= 1000 ? `${(val / 1000).toFixed(0)}K` : val}
                        {key === 'engagement_rate' ? '%' : ''}
                      </div>
                      <div className="text-[11px] text-gray-400 capitalize mt-0.5">{key.replace(/_/g, ' ')}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {((c.platforms?.length ?? 0) > 0 || (c.hashtags?.length ?? 0) > 0 || (c.social_tags?.length ?? 0) > 0) && (
              <div className="card p-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Plataformas, hashtags y tags</h3>
                {(c.platforms?.length ?? 0) > 0 && (
                  <div className="flex items-center gap-2 mb-3 flex-wrap">
                    {c.platforms?.map(p => (
                      <span key={p} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 rounded-lg text-sm font-medium text-gray-700">
                        {PLATFORM_ICONS[p]} {p.charAt(0).toUpperCase() + p.slice(1)}
                      </span>
                    ))}
                  </div>
                )}
                {(c.social_tags?.length ?? 0) > 0 && (
                  <div className="mb-3">
                    <p className="text-xs text-gray-400 mb-1.5 font-medium">Tags obligatorios en posts:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {c.social_tags!.map(t => (
                        <span key={t} className="px-2.5 py-1 bg-violet-100 text-violet-700 rounded-md text-xs font-semibold">{t}</span>
                      ))}
                    </div>
                  </div>
                )}
                {(c.hashtags?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {c.hashtags?.map(h => (
                      <span key={h} className="px-2.5 py-1 bg-violet-50 text-violet-700 rounded-md text-xs font-medium">{h}</span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Deliverable templates */}
            {(c.deliverable_templates?.length ?? 0) > 0 && (
              <div className="card p-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Deliverables requeridos por campaña</h3>
                <div className="space-y-2">
                  {c.deliverable_templates!.map(dt => (
                    <div key={dt.type} className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-gray-800 capitalize">{dt.type.replace(/_/g,' ')}</span>
                          <span className="badge badge-gray text-[10px]">x{dt.quantity}</span>
                          {dt.due_date && <span className="text-xs text-gray-400">→ {dt.due_date}</span>}
                        </div>
                        {dt.description && <p className="text-xs text-gray-500 mt-0.5">{dt.description}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Comisión */}
            {c.brand && (
              <div className="card p-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  🏢 Marca
                </h3>
                <div className="flex items-center gap-3">
                  {(c.brand as {logo_url?: string|null; name: string}).logo_url && (
                    <img src={(c.brand as {logo_url: string}).logo_url} alt={(c.brand as {name:string}).name}
                      className="w-10 h-10 rounded-lg object-contain border border-gray-100 p-0.5" />
                  )}
                  <div>
                    <div className="font-semibold text-gray-900">{(c.brand as {name:string}).name}</div>
                  </div>
                </div>
              </div>
            )}
            {c.commission_rate && (
              <div className="card p-5 border-2 border-violet-100">
                <h3 className="text-sm font-semibold text-violet-800 mb-1">💰 Campaña por comisión</h3>
                <p className="text-2xl font-black text-violet-700">{c.commission_rate}%</p>
                <p className="text-xs text-gray-400 mt-0.5">de las ventas generadas por cada influencer</p>
              </div>
            )}

            {/* Visibility badge */}
            <div className="card p-4 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-gray-700">Visibilidad</h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  {(c as {visibility?: string}).visibility === 'public'
                    ? 'Las influencers pueden postular desde su portal'
                    : 'Solo por invitación del equipo'}
                </p>
              </div>
              <button
                onClick={async () => {
                  const current = (c as {visibility?: string}).visibility ?? 'invite_only'
                  const next = current === 'public' ? 'invite_only' : 'public'
                  await fetch(`/api/campaigns/${id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ visibility: next }),
                  })
                  void refetch()
                }}
                className={cn(
                  'text-xs font-bold px-3 py-1.5 rounded-full border transition-colors',
                  (c as {visibility?: string}).visibility === 'public'
                    ? 'bg-green-100 text-green-700 border-green-200 hover:bg-green-200'
                    : 'bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-200'
                )}
              >
                {(c as {visibility?: string}).visibility === 'public' ? '🌐 Pública' : '🔒 Invitación'}
              </button>
            </div>

            {c.content_guidelines && (
              <div className="card p-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Guías de contenido</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{c.content_guidelines}</p>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">Budget</h3>
              <div className="space-y-3">
                {[
                  { label: 'Total asignado', value: c.budget_total ?? 0, color: 'text-gray-900' },
                  { label: 'Gastado',         value: c.budget_spent,      color: 'text-violet-700' },
                  { label: 'Disponible',      value: (c.budget_total ?? 0) - c.budget_spent, color: budgetPct > 90 ? 'text-red-600' : 'text-emerald-600' },
                ].map(({ label, value, color }) => (
                  <div key={label} className="flex justify-between items-center">
                    <span className="text-xs text-gray-500">{label}</span>
                    <span className={cn('text-sm font-bold', color)}>{formatCurrency(value, c.currency)}</span>
                  </div>
                ))}
                <div className="pt-2">
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className={cn('h-full rounded-full', budgetPct > 90 ? 'bg-red-400' : 'bg-violet-500')}
                      style={{ width: `${Math.min(budgetPct, 100)}%` }} />
                  </div>
                  <div className="text-[10px] text-gray-400 mt-1 text-right">{budgetPct}% utilizado</div>
                </div>
              </div>
            </div>

            {(c.tags ?? []).length > 0 && (
              <div className="card p-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Tags</h3>
                <div className="flex flex-wrap gap-1.5">
                  {c.tags?.map(t => <span key={t} className="badge badge-gray">{t}</span>)}
                </div>
              </div>
            )}

            <div className="card p-4 space-y-2">
              <h3 className="text-sm font-semibold text-gray-700 mb-1">Acciones rápidas</h3>
              {[
                { label: '+ Agregar influencer', href: `/campaigns/${id}/influencers/add`, color: 'text-violet-700 bg-violet-50 hover:bg-violet-100' },
                { label: '📄 Ver contratos',      href: `/contracts`,  color: 'text-gray-700 bg-gray-50 hover:bg-gray-100' },
                { label: '💳 Crear factura',      href: `/billing`,    color: 'text-gray-700 bg-gray-50 hover:bg-gray-100' },
                { label: '💸 Crear payroll run',  href: `/billing`,    color: 'text-gray-700 bg-gray-50 hover:bg-gray-100' },
              ].map(({ label, href, color }) => (
                <Link key={label} href={href} className={cn('block w-full px-3 py-2 rounded-lg text-sm font-medium transition-colors', color)}>
                  {label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── INFLUENCERS ─────────────────────────────────────────────────────── */}
      {tab === 'influencers' && (
        <div className="space-y-4">
          {/* Pending applications */}
          {campaignInfluencers.filter(ci => ci.status === 'applied').length > 0 && (
            <div className="card p-4 border-amber-200 bg-amber-50">
              <p className="text-xs font-bold text-amber-700 uppercase tracking-wider mb-3 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                {campaignInfluencers.filter(ci => ci.status === 'applied').length} solicitud(es) pendiente(s)
              </p>
              <div className="space-y-2">
                {campaignInfluencers.filter(ci => ci.status === 'applied').map(ci => {
                  const inf = ci.influencer
                  if (!inf) return null
                  return (
                    <div key={ci.id} className="flex items-center gap-3 bg-white rounded-xl p-3 border border-amber-100">
                      {inf.avatar_url ? (
                        <img src={inf.avatar_url} alt={inf.display_name} className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                          {inf.display_name.charAt(0)}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <Link href={`/influencers/${inf.id}`} className="text-sm font-semibold text-gray-900 hover:text-violet-700">
                          {inf.display_name}
                        </Link>
                        {inf.influencer_social_profiles?.[0] && (
                          <p className="text-xs text-gray-400">
                            @{inf.influencer_social_profiles[0].username} · {((inf.influencer_social_profiles[0].followers ?? 0)/1000).toFixed(0)}K
                          </p>
                        )}
                      </div>
                      <div className="flex gap-2 flex-shrink-0">
                        <button
                          onClick={async () => {
                            await fetch(`/api/campaigns/${id}/influencers`, {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ influencer_id: inf.id, status: 'active' }),
                            })
                            void refetch()
                          }}
                          className="text-xs font-bold bg-green-600 text-white px-3 py-1 rounded-lg hover:bg-green-700"
                        >
                          Aceptar
                        </button>
                        <button
                          onClick={async () => {
                            if (!confirm(`¿Rechazar la solicitud de ${inf.display_name}?`)) return
                            await fetch(`/api/campaigns/${id}/influencers?influencer_id=${inf.id}`, { method: 'DELETE' })
                            void refetch()
                          }}
                          className="text-xs font-bold bg-white text-red-500 border border-red-200 px-3 py-1 rounded-lg hover:bg-red-50"
                        >
                          Rechazar
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-500">
              {campaignInfluencers.filter(ci => ci.status !== 'applied').length} influencer{campaignInfluencers.length !== 1 ? 's' : ''} asignado{campaignInfluencers.length !== 1 ? 's' : ''}
            </p>
            <Link href={`/campaigns/${id}/influencers/add`}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-white bg-violet-600 rounded-lg hover:bg-violet-700 transition-colors">
              + Agregar influencer
            </Link>
          </div>

          {confirmedInfluencers.length === 0 ? (
            <div className="card p-12 text-center">
              <Users className="h-10 w-10 text-gray-200 mx-auto mb-3" />
              <p className="text-sm text-gray-400">Sin influencers asignados aún</p>
              <Link href={`/campaigns/${id}/influencers/add`}
                className="mt-3 inline-block text-sm text-violet-600 hover:underline font-medium">+ Agregar el primero</Link>
            </div>
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full min-w-[640px]">
                <thead>
                  <tr className="border-b border-gray-100">
                    {['Influencer', 'Plataforma', 'Fee', 'Deliverables', 'Progreso', 'Estado', ''].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider bg-gray-50">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {confirmedInfluencers.map((ci, i) => {
                    const inf = ci.influencer
                    if (!inf) return null
                    const primarySP = inf.influencer_social_profiles?.[0]
                    const myDelivs    = campaignDeliverables.filter(d => d.influencer?.id === inf.id)
                    const delivsDone  = myDelivs.filter(d => d.status === 'published').length
                    const delivsTotal = myDelivs.length
                    const p = delivsTotal > 0
                      ? Math.round(myDelivs.reduce((sum, d) => {
                          if (d.status === 'published') return sum + 100
                          return sum + (d.progress ?? 0)
                        }, 0) / delivsTotal)
                      : 0
                    const gradient = GRADIENTS[i % GRADIENTS.length]
                    const initials = inf.display_name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()

                    return (
                      <tr key={ci.id} className="hover:bg-gray-50/70 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            {inf.avatar_url ? (
                              <img src={inf.avatar_url} alt={inf.display_name} className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
                            ) : (
                              <div className={cn('w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold bg-gradient-to-br flex-shrink-0', gradient)}>
                                {initials}
                              </div>
                            )}
                            <div>
                              <Link href={`/influencers/${inf.id}`}
                                className="text-sm font-semibold text-gray-900 hover:text-violet-700 transition-colors">
                                {inf.display_name}
                              </Link>
                              {primarySP?.username && <div className="text-xs text-gray-400">@{primarySP.username}</div>}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500">
                          {primarySP ? (
                            <span className="flex items-center gap-1.5">
                              {PLATFORM_ICONS[primarySP.platform]}
                              <span className="font-medium">{((primarySP.followers ?? 0) / 1000).toFixed(0)}K</span>
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm font-bold text-gray-900">{ci.fee ? formatCurrency(ci.fee, 'CLP') : '—'}</span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500">
                          <span className={cn('font-semibold', delivsDone === delivsTotal && delivsTotal > 0 ? 'text-emerald-600' : 'text-gray-900')}>
                            {delivsDone}
                          </span>/{delivsTotal}
                        </td>
                        <td className="px-4 py-3 min-w-[120px]">
                          {delivsTotal > 0 ? (
                            <>
                              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div className={cn('h-full rounded-full', p === 100 ? 'bg-emerald-500' : 'bg-violet-500')} style={{ width: `${p}%` }} />
                              </div>
                              <div className="text-[10px] text-gray-400 mt-0.5">{p}%</div>
                            </>
                          ) : <span className="text-xs text-gray-300">Sin deliverables</span>}
                        </td>
                        <td className="px-4 py-3">
                          <select
                            value={ci.status ?? 'draft'}
                            onChange={async e => {
                              try {
                                await fetch(`/api/campaigns/${id}/influencers`, {
                                  method: 'PATCH',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ influencer_id: inf.id, status: e.target.value }),
                                })
                                void refetch()
                              } catch { /* non-fatal */ }
                            }}
                            className={cn('text-[11px] font-semibold rounded-full px-2 py-0.5 border-0 outline-none cursor-pointer',
                              ci.status === 'active'           ? 'bg-emerald-100 text-emerald-700' :
                              ci.status === 'completed'         ? 'bg-blue-100 text-blue-700' :
                              ci.status === 'canceled'          ? 'bg-red-100 text-red-700' :
                              ci.status === 'pending_approval'  ? 'bg-amber-100 text-amber-700' :
                              'bg-gray-100 text-gray-600'
                            )}
                          >
                            <option value="draft">Por confirmar</option>
                            <option value="pending_approval">En revisión</option>
                            <option value="active">Activo</option>
                            <option value="paused">Pausado</option>
                            <option value="completed">Completado</option>
                            <option value="canceled">Cancelado</option>
                          </select>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <a
                              href={`/api/campaigns/${id}/influencer-report?influencer_id=${inf.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1.5 rounded-lg text-gray-300 hover:text-violet-600 hover:bg-violet-50 transition-colors"
                              title="Ver reporte del influencer"
                            >
                              <FileDown className="h-3.5 w-3.5" />
                            </a>
                            <button
                              onClick={() => {
                                if (confirm(`¿Eliminar a ${inf.display_name} de esta campaña?`)) {
                                  removeInfluencer.mutate(inf.id)
                                }
                              }}
                              disabled={removeInfluencer.isPending}
                              className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50"
                              title="Eliminar de campaña"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── DELIVERABLES ─────────────────────────────────────────────────────── */}
      {tab === 'deliverables' && (
        <div className="space-y-3">
          {/* Header with status pills + Add button */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              {(Object.entries(DEL_CONFIG) as [DeliverableStatus, typeof DEL_CONFIG[DeliverableStatus]][]).map(([st, cfg]) => {
                const count = campaignDeliverables.filter(d => d.status === st).length
                if (count === 0) return null
                return (
                  <div key={st} className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold badge', cfg.cls)}>
                    {cfg.icon} {cfg.label}: {count}
                  </div>
                )
              })}
            </div>
            <button
              onClick={() => setAddingDeliverable(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-violet-600 text-white hover:bg-violet-700 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" /> Agregar deliverable
            </button>
          </div>

          {/* Inline add form */}
          {addingDeliverable && (
            <AddDeliverableForm
              campaignId={id}
              influencers={campaignInfluencers.map(ci => ({ id: ci.influencer?.id ?? '', name: ci.influencer?.display_name ?? 'Influencer' }))}
              onSuccess={() => { setAddingDeliverable(false); void refetch() }}
              onCancel={() => setAddingDeliverable(false)}
            />
          )}

          {campaignDeliverables.length === 0 && !addingDeliverable ? (
            <div className="card p-12 text-center">
              <FileText className="h-10 w-10 text-gray-200 mx-auto mb-3" />
              <p className="text-sm text-gray-400">Sin deliverables asignados aún</p>
              <button onClick={() => setAddingDeliverable(true)}
                className="mt-3 text-xs text-violet-600 hover:underline">
                + Agregar el primero
              </button>
            </div>
          ) : (
            campaignDeliverables.map(d => (
              <DeliverableCard key={d.id} d={d} campaignId={id} reviewNotes={reviewNotes} setReviewNotes={setReviewNotes} />
            ))
          )}
        </div>
      )}

      {/* ── HISTORIAL ────────────────────────────────────────────────────────── */}
      {/* ── CANJES ─────────────────────────────────────────────────────────── */}
      {tab === 'canjes' && (
        <BartersTab campaignId={id} campaignInfluencers={campaignInfluencers} />
      )}

      {tab === 'history' && (
        <div className="card p-6 space-y-4">
          <h3 className="text-sm font-semibold text-gray-700">Actividad de la campaña</h3>
          
          {/* Timeline */}
          <div className="space-y-0">
            {/* Campaign created */}
            <TimelineItem
              icon="🚀" color="violet"
              title="Campaña creada"
              date={c.created_at}
              desc={`Tipo: ${{sponsored_post:'Sponsored Post',ambassador:'Embajador',ugc:'UGC',event_appearance:'Evento',product_seeding:'Product Seeding',live:'Live',commission:'Por Comisión'}[c.type as string] ?? c.type}`}
            />

            {/* Status changes from deliverables */}
            {[...campaignDeliverables]
              .filter(d => d.published_at || d.submitted_at)
              .sort((a, b) => {
                const da = a.submitted_at || a.published_at || ''
                const db2 = b.submitted_at || b.published_at || ''
                return da < db2 ? -1 : 1
              })
              .map(d => (
                <TimelineItem
                  key={d.id}
                  icon={d.status === 'published' ? '✅' : d.status === 'approved' ? '👍' : d.status === 'rejected' ? '❌' : '📤'}
                  color={d.status === 'published' ? 'emerald' : d.status === 'approved' ? 'blue' : d.status === 'rejected' ? 'red' : 'amber'}
                  title={`${d.status === 'published' ? 'Publicado' : d.status === 'approved' ? 'Aprobado' : d.status === 'rejected' ? 'Rechazado' : 'Enviado para revisión'}: ${d.title ?? d.type}`}
                  date={d.submitted_at || d.published_at || ''}
                  desc={d.influencer?.display_name ?? ''}
                />
              ))
            }

            {/* Last update */}
            {c.updated_at && c.updated_at !== c.created_at && (
              <TimelineItem
                icon="✏️" color="gray"
                title={`Estado actual: ${c.status}`}
                date={c.updated_at}
                desc=""
              />
            )}
          </div>

          {campaignDeliverables.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-4">Sin actividad de deliverables aún.</p>
          )}
        </div>
      )}
    </div>
  )
}
