'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, CheckCircle2, XCircle, Clock, ExternalLink,
  Users, ChevronDown, ChevronUp, RefreshCw,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { fmtDate, fmtMoney, deliverableProgress, DELIVERABLE_STATUS } from '@/lib/campaign-utils'
import { BartersReadonly } from '@/components/campaigns/BartersReadonly'

// ── Types ─────────────────────────────────────────────────────────────────────
type DelStatus = 'pending' | 'in_review' | 'approved' | 'rejected' | 'published'

interface Deliverable {
  id: string
  title: string
  type: string
  status: DelStatus
  due_date: string | null
  content_url: string | null
  submitted_at: string | null
  published_url: string | null
  review_notes: string | null
  platform: string | null
  influencer: { id: string; display_name: string; avatar_url: string | null } | null
}

interface Campaign {
  id: string
  name: string
  description: string | null
  status: string
  start_date: string | null
  end_date: string | null
  budget_total: number | null
  currency: string
  content_guidelines: string | null
  campaign_influencers: Array<{
    id: string; status: string; fee: number | null; currency: string
    influencer: { id: string; display_name: string; avatar_url: string | null; city: string | null } | null
  }>
  campaign_deliverables: Deliverable[]
}

// ── DeliverableCard ───────────────────────────────────────────────────────────
function DeliverableCard({ d, onReviewed }: { d: Deliverable; onReviewed: () => void }) {
  const [expanded, setExpanded] = useState(d.status === 'in_review')
  const [notes,    setNotes]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const cfg       = DELIVERABLE_STATUS[d.status] ?? DELIVERABLE_STATUS.pending
  const canReview = d.status === 'in_review'
  const link      = d.content_url || d.published_url

  async function review(action: 'approve' | 'reject') {
    setLoading(true)
    try {
      const res  = await fetch(`/api/brand/deliverables/${d.id}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, review_notes: notes || null }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success(action === 'approve' ? '✅ Aprobado' : '❌ Rechazado')
      onReviewed()
    } catch (e) { toast.error((e as Error).message) }
    setLoading(false)
  }

  return (
    <div className={cn(
      'border rounded-xl overflow-hidden transition-all',
      d.status === 'in_review' ? 'border-amber-200 bg-amber-50/30' :
      d.status === 'approved'  ? 'border-green-100 bg-green-50/20' :
      d.status === 'rejected'  ? 'border-red-100 bg-red-50/20' : 'border-gray-100 bg-white'
    )}>
      <button className="w-full flex items-start gap-3 p-4 text-left hover:bg-black/5 transition-colors"
        onClick={() => setExpanded(v => !v)}>
        <div className="mt-0.5 flex-shrink-0">
          {d.status === 'approved' || d.status === 'published'
            ? <CheckCircle2 className="h-4 w-4 text-green-500" />
            : d.status === 'rejected' ? <XCircle className="h-4 w-4 text-red-400" />
            : d.status === 'in_review' ? <Clock className="h-4 w-4 text-amber-500" />
            : <div className="h-4 w-4 rounded-full border-2 border-gray-200" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-900">{d.title || d.type}</span>
            <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full', cfg.color)}>{cfg.label}</span>
            {d.platform && <span className="text-[10px] text-gray-400 capitalize">{d.platform}</span>}
          </div>
          {d.influencer && <p className="text-xs text-gray-500 mt-0.5">{d.influencer.display_name}</p>}
          {d.due_date && <p className="text-xs text-gray-400">Vence: {fmtDate(d.due_date)}</p>}
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 text-gray-300 flex-shrink-0" /> : <ChevronDown className="h-4 w-4 text-gray-300 flex-shrink-0" />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-black/5 pt-3">
          {link ? (
            <a href={link} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-sm text-violet-600 hover:underline font-medium">
              <ExternalLink className="h-3.5 w-3.5" /> Ver contenido enviado
              {d.submitted_at && <span className="text-xs text-gray-400 ml-1">— {fmtDate(d.submitted_at)}</span>}
            </a>
          ) : (
            <p className="text-xs text-gray-400 italic">El influencer aún no ha enviado contenido.</p>
          )}
          {d.review_notes && (
            <div className="bg-white rounded-lg border border-gray-100 px-3 py-2">
              <p className="text-xs font-semibold text-gray-500 mb-1">Nota anterior</p>
              <p className="text-sm text-gray-700">{d.review_notes}</p>
            </div>
          )}
          {canReview && (
            <div className="space-y-2">
              <textarea value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="Notas para el influencer (opcional)..." rows={2}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-violet-400 resize-none" />
              <div className="flex gap-2">
                <button onClick={() => review('reject')} disabled={loading}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-semibold border border-red-200 text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors">
                  <XCircle className="h-4 w-4" /> Rechazar
                </button>
                <button onClick={() => review('approve')} disabled={loading}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors">
                  <CheckCircle2 className="h-4 w-4" /> Aprobar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export function BrandCampaignView({ id }: { id: string }) {
  const router = useRouter()
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [loading,  setLoading]  = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch(`/api/brand/campaigns/${id}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setCampaign(json.data)
    } catch (e) { toast.error((e as Error).message) }
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  if (loading) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="w-10 h-10 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
    </div>
  )

  if (!campaign) return (
    <div className="text-center py-16">
      <p className="text-gray-400">Campaña no encontrada.</p>
      <button onClick={() => router.push('/brand/dashboard')} className="mt-4 text-violet-600 hover:underline text-sm">
        ← Volver al dashboard
      </button>
    </div>
  )

  const { done: delDone, total: delTotal, pct } = deliverableProgress(campaign.campaign_deliverables as never)
  const delReview = campaign.campaign_deliverables.filter(d => d.status === 'in_review').length

  // Agrupar por influencer
  const byInfluencer = new Map<string, { name: string; avatar: string | null; deliverables: Deliverable[] }>()
  for (const d of campaign.campaign_deliverables) {
    const key = d.influencer?.id ?? 'sin_influencer'
    if (!byInfluencer.has(key)) {
      byInfluencer.set(key, { name: d.influencer?.display_name ?? 'Sin asignar', avatar: d.influencer?.avatar_url ?? null, deliverables: [] })
    }
    byInfluencer.get(key)!.deliverables.push(d)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <button onClick={() => router.push('/brand/dashboard')}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4">
          <ArrowLeft className="h-4 w-4" /> Volver
        </button>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{campaign.name}</h1>
            {campaign.description && <p className="text-sm text-gray-500 mt-1">{campaign.description}</p>}
            <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
              <span>{fmtDate(campaign.start_date)} → {fmtDate(campaign.end_date)}</span>
              <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {campaign.campaign_influencers.length}</span>
              {campaign.budget_total && <span>{fmtMoney(campaign.budget_total, campaign.currency)}</span>}
            </div>
          </div>
          <button onClick={load} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 flex-shrink-0">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Progreso */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-gray-700">Progreso</h2>
          <span className="text-2xl font-bold text-violet-600">{pct}%</span>
        </div>
        <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden mb-3">
          <div className="h-full bg-violet-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span>{delDone} aprobados</span>
          {delReview > 0 && <span className="text-amber-600 font-semibold">{delReview} para revisar</span>}
          <span>{delTotal - delDone - delReview} pendientes</span>
        </div>
      </div>

      {/* Deliverables por influencer */}
      <div className="space-y-6">
        {Array.from(byInfluencer.entries()).map(([key, { name, avatar, deliverables }]) => (
          <div key={key}>
            <div className="flex items-center gap-2.5 mb-3">
              {avatar
                ? <img src={avatar} alt={name} className="w-8 h-8 rounded-full object-cover" />
                : <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center text-white text-xs font-bold">{name[0]}</div>
              }
              <span className="text-sm font-bold text-gray-800">{name}</span>
              <span className="text-xs text-gray-400">{deliverables.length} entregable(s)</span>
            </div>
            <div className="space-y-2 ml-10">
              {deliverables.map(d => <DeliverableCard key={d.id} d={d} onReviewed={load} />)}
            </div>
          </div>
        ))}
      </div>

      {/* Canjes (solo lectura) */}
      <BartersReadonly endpoint={`/api/brand/campaigns/${id}/barters`} />

      {campaign.content_guidelines && (
        <div className="bg-violet-50 rounded-2xl border border-violet-100 p-5">
          <h2 className="text-sm font-bold text-violet-800 mb-2">Lineamientos de contenido</h2>
          <p className="text-sm text-violet-700 whitespace-pre-wrap">{campaign.content_guidelines}</p>
        </div>
      )}
    </div>
  )
}
