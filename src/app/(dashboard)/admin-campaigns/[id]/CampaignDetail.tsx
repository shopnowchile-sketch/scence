'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  ArrowLeft, Target, Calendar, DollarSign, Users, FileText,
  BarChart3, ExternalLink, CheckCircle2,
  XCircle, Clock, Pencil, Play, Pause, Check, AlertCircle, Loader2, Trash2, Plus, FileDown, Gift,
  ChevronRight, Search, X, ChevronDown, Star, Mail, Eye, Heart, MessageCircle, RefreshCw, MapPin,
} from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { cn, formatCurrency, formatDate, formatDatetime, formatFollowers, PLATFORM_ICONS } from '@/lib/utils'
import { CampaignStatusBadge, campaignStatusLabel, campaignStatusBadgeClass, CAMPAIGN_STATUS_OPTIONS } from '@/components/campaigns/CampaignStatusBadge'
import { BartersTab } from '@/components/campaigns/BartersTab'
import { StarRating } from '@/components/ui/StarRating'
import { ColumnVisibilityMenu } from '@/components/ui/ColumnVisibilityMenu'
import { useLocalStorageState } from '@/hooks/useLocalStorageState'
import type { CampaignDetail, CampaignDeliverableDetail, DeliverableStatus, CampaignStatus } from '@/types'
import { useCampaignDetail, usePatchCampaign, useDeliverableAction, useRemoveCampaignInfluencer, useSyncDeliverableMetrics } from '@/hooks/useCampaignsList'
import { isDeliverableComplete } from '@/lib/deliverable-status'
import { toast } from 'sonner'

// ── Helpers (mismo patrón que InfluencerCard.tsx / InfluencerProfile.tsx) ─────
function buildProfileUrl(platform: string, username: string | null): string | null {
  if (!username) return null
  const u = username.replace(/^@/, '')
  switch (platform) {
    case 'instagram': return `https://instagram.com/${u}`
    case 'tiktok':    return `https://tiktok.com/@${u}`
    case 'youtube':   return `https://youtube.com/@${u}`
    case 'twitter':   return `https://twitter.com/${u}`
    case 'facebook':  return `https://facebook.com/${u}`
    case 'linkedin':  return `https://linkedin.com/in/${u}`
    default:          return null
  }
}

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

type Tab = 'overview' | 'influencers' | 'deliverables' | 'assets' | 'locations' | 'billing' | 'history'

// ── Columnas toggleables de la tabla del tab Influencers (mismo patrón que
// admin-brands/page.tsx: Influencer y Acciones quedan siempre fijas). ────────
type CiColumnKey = 'platform' | 'fee' | 'deliverables' | 'progress' | 'status'
const CI_COLUMNS: Array<{ key: CiColumnKey; label: string }> = [
  { key: 'platform',     label: 'Plataforma' },
  { key: 'fee',          label: 'Fee' },
  { key: 'deliverables', label: 'Deliverables' },
  { key: 'progress',     label: 'Progreso' },
  { key: 'status',       label: 'Estado' },
]
const DEFAULT_CI_COLUMNS: Record<CiColumnKey, boolean> =
  Object.fromEntries(CI_COLUMNS.map(c => [c.key, true])) as Record<CiColumnKey, boolean>

// ── Deliverable content — tipo + link + rating + estado, todo en 1 línea. ────
// Rediseño pedido por Pri: antes cada card mostraba el título completo (a
// veces el brief entero) + fecha + progreso + todo junto, muy cargado. Después
// pidió que quepa en una sola fila (sin envolver en 2-3 líneas).
function DeliverableContent({
  d, campaignId, reviewNotes, setReviewNotes,
}: {
  d: CampaignDeliverableDetail
  campaignId: string
  reviewNotes: Record<string, string>
  setReviewNotes: React.Dispatch<React.SetStateAction<Record<string, string>>>
}) {
  const action = useDeliverableAction(campaignId)
  const syncMetrics = useSyncDeliverableMetrics(campaignId)
  const cfg = DEL_CONFIG[d.status] ?? DEL_CONFIG.pending
  const url = d.published_url || d.content_url
  const typeLabel = d.type ? d.type.replace(/_/g, ' ') : (d.platform ?? 'Contenido')

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

  async function handleRate(rating: number) {
    try {
      await action.mutateAsync({ deliverable_id: d.id, action: 'rate', rating })
    } catch { /* handled in hook */ }
  }

  async function handleSyncMetrics() {
    try {
      await syncMetrics.mutateAsync(d.id)
    } catch { /* handled in hook */ }
  }

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
        <div className="flex items-center gap-1.5 min-w-0 flex-shrink-0">
          {d.platform && PLATFORM_ICONS[d.platform] ? <span>{PLATFORM_ICONS[d.platform]}</span> : null}
          <span className="text-sm font-semibold text-gray-800 capitalize whitespace-nowrap">{typeLabel}:</span>
          {url ? (
            <a href={url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 text-sm text-violet-600 hover:underline whitespace-nowrap">
              <ExternalLink className="h-3.5 w-3.5 flex-shrink-0" /> Ver contenido
            </a>
          ) : (
            <span className="text-sm text-gray-300 whitespace-nowrap">Sin URL</span>
          )}
        </div>

        <div className="flex items-center gap-2.5 flex-shrink-0 ml-auto">
          <StarRating value={d.content_rating} onChange={handleRate} />
          <span className={cn('badge text-[11px] flex items-center gap-1 whitespace-nowrap', cfg.cls)}>
            {cfg.icon} {cfg.label}
          </span>
          {d.status === 'in_review' && (
            <>
              <button onClick={() => handle('reject')} disabled={action.isPending}
                title="Rechazar"
                className="p-1.5 rounded-lg text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 disabled:opacity-50 transition-colors">
                <XCircle className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => handle('approve')} disabled={action.isPending}
                title="Aprobar"
                className="p-1.5 rounded-lg text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 transition-colors">
                <CheckCircle2 className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      {d.status === 'in_review' && (
        <input
          placeholder="Nota de revisión (opcional)..."
          value={reviewNotes[d.id] ?? ''}
          onChange={e => setReviewNotes(prev => ({ ...prev, [d.id]: e.target.value }))}
          className="input-base text-xs mt-1.5 w-full max-w-md"
        />
      )}

      {d.review_notes && (
        <div className={cn(
          'mt-1.5 text-xs rounded-lg px-3 py-1.5 inline-block',
          d.status === 'rejected' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'
        )}>
          💬 {d.review_notes}
        </div>
      )}

      {/* Métricas reales de publicación (Apify) — solo views/likes/comments.
          reach/impresiones/guardados/compartidos no existen, no se inventan.
          Engagement siempre etiquetado como calculado. */}
      <div className="mt-1.5 flex items-center gap-3 flex-wrap">
        {!url ? (
          <span className="text-[11px] text-gray-300">Falta link para traer métricas</span>
        ) : d.performance ? (
          <>
            <span className="flex items-center gap-1 text-[11px] text-gray-500">
              <Eye className="h-3 w-3" /> {d.performance.views != null ? formatFollowers(d.performance.views) : '—'}
            </span>
            <span className="flex items-center gap-1 text-[11px] text-gray-500">
              <Heart className="h-3 w-3" /> {d.performance.likes != null ? formatFollowers(d.performance.likes) : '—'}
            </span>
            <span className="flex items-center gap-1 text-[11px] text-gray-500">
              <MessageCircle className="h-3 w-3" /> {d.performance.comments != null ? formatFollowers(d.performance.comments) : '—'}
            </span>
            {d.engagement_rate != null && (
              <span className="text-[11px] text-violet-600 font-semibold" title="Calculado, no es un dato real de Instagram">
                {d.engagement_rate}% eng. (calc.)
              </span>
            )}
            {d.metrics_updated_at && (
              <span className="text-[10px] text-gray-300">Actualizado {formatDatetime(d.metrics_updated_at)}</span>
            )}
            <button
              onClick={handleSyncMetrics}
              disabled={syncMetrics.isPending}
              className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-violet-600 transition-colors disabled:opacity-50"
            >
              {syncMetrics.isPending
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <RefreshCw className="h-3 w-3" />}
              Actualizar
            </button>
          </>
        ) : (
          <button
            onClick={handleSyncMetrics}
            disabled={syncMetrics.isPending}
            className="flex items-center gap-1.5 text-[11px] font-semibold text-violet-600 hover:underline disabled:opacity-50"
          >
            {syncMetrics.isPending
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <RefreshCw className="h-3 w-3" />}
            Actualizar métricas
          </button>
        )}
      </div>
    </div>
  )
}

// ── Avatar + nombre + Instagram clickeable — compartido entre el modo de
// 1 fila y el header colapsable del dropdown.
function InfluencerBadge({
  influencer, igUsername,
}: {
  influencer: { id: string; display_name: string; avatar_url: string | null }
  igUsername: string | null
}) {
  const cleanIg = igUsername ? igUsername.replace(/^@/, '') : null
  const igUrl = buildProfileUrl('instagram', cleanIg)
  const gradient = GRADIENTS[influencer.display_name.charCodeAt(0) % GRADIENTS.length]

  return (
    <div className="flex items-center gap-2 min-w-0 flex-shrink-0">
      <div className={cn('w-7 h-7 rounded-full flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0 bg-gradient-to-br overflow-hidden', gradient)}>
        {influencer.avatar_url
          ? <img src={influencer.avatar_url} alt={influencer.display_name} className="w-full h-full object-cover" />
          : influencer.display_name.charAt(0).toUpperCase()}
      </div>
      <div className="min-w-0 leading-tight">
        <p className="text-xs font-semibold text-gray-900 truncate">{influencer.display_name}</p>
        <div className="flex items-center gap-1.5">
          {igUrl ? (
            <a href={igUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
              className="text-[11px] text-violet-600 hover:underline whitespace-nowrap">
              @{cleanIg}
            </a>
          ) : (
            <span className="text-[11px] text-gray-300 whitespace-nowrap">Sin Instagram</span>
          )}
        </div>
      </div>
    </div>
  )
}

// Bloque de stat genérico (número grande + label chico) — mismo tamaño para
// seguidores y métricas de contenido, pedido por Pri ("estas métricas al
// lado de los seguidores del mismo tamaño pero ordenado").
function StatBlock({ icon: Icon, value, label, valueClass }: {
  icon?: React.ComponentType<{ className?: string }>
  value: React.ReactNode
  label: string
  valueClass?: string
}) {
  return (
    <div className="text-center flex-shrink-0">
      <div className={cn('text-sm font-bold text-gray-900 flex items-center justify-center gap-1', valueClass)}>
        {Icon && <Icon className="h-3 w-3 text-gray-400" />}
        {value}
      </div>
      <div className="text-[9px] text-gray-400">{label}</div>
    </div>
  )
}

// Seguidores en grande — pedido explícito de Pri ("vista clara... en grande"),
// separado del @handle chico para que no se pierda entre el resto del texto.
function FollowersStat({ followers }: { followers: number | null }) {
  if (!followers) return null
  return <StatBlock value={formatFollowers(followers)} label="seguidores" />
}

// Métricas reales de contenido (Apify), mismo tamaño que seguidores, en fila
// ordenada. Views/likes/comments son reales; engagement SIEMPRE calculado
// por nosotros (nunca "alcance" — no existe reach/impressions/saves/shares).
function ContentMetricsStats({ metrics }: {
  metrics: { views: number; likes: number; comments: number; avgEngagement: number | null } | null
}) {
  return (
    <div className="flex items-center gap-3 flex-shrink-0">
      <StatBlock icon={Eye} value={metrics ? formatFollowers(metrics.views) : '—'} label="visualizaciones" />
      <StatBlock icon={Heart} value={metrics ? formatFollowers(metrics.likes) : '—'} label="likes" />
      <StatBlock icon={MessageCircle} value={metrics ? formatFollowers(metrics.comments) : '—'} label="comentarios" />
      <StatBlock
        value={metrics?.avgEngagement != null ? `${metrics.avgEngagement}%` : '—'}
        label="engagement (calc.)"
        valueClass="text-violet-600"
      />
    </div>
  )
}

// ── Grupo por influencer. 1 solo deliverable → todo en 1 fila (avatar +
// nombre + Instagram + tipo + link + rating + estado). Más de uno → dropdown
// colapsable con el header arriba y cada deliverable en su propia fila adentro.
function RemindButton({ campaignId, influencerId, compact, onSent }: { campaignId: string; influencerId: string; compact?: boolean; onSent?: () => void }) {
  const [sending, setSending] = useState(false)

  async function handleRemind() {
    setSending(true)
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/deliverables/remind`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ influencer_id: influencerId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'Error al enviar recordatorio')
      toast.success('Recordatorio enviado')
      onSent?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al enviar recordatorio')
    } finally {
      setSending(false)
    }
  }

  if (compact) {
    return (
      <button
        onClick={handleRemind}
        disabled={sending}
        title="Enviar recordatorio de entregables pendientes"
        className="p-1.5 rounded-lg text-amber-500 hover:text-amber-600 hover:bg-amber-50 transition-colors disabled:opacity-50 flex-shrink-0"
      >
        {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
      </button>
    )
  }

  return (
    <button
      onClick={handleRemind}
      disabled={sending}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-white border border-gray-200 text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-50 flex-shrink-0"
    >
      {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
      Enviar recordatorio
    </button>
  )
}

function DeliverableInfluencerGroup({
  influencer, igUsername, followers, items, campaignId, reviewNotes, setReviewNotes, pct, avgRating, ratedCount, metrics,
}: {
  influencer: { id: string; display_name: string; avatar_url: string | null }
  igUsername: string | null
  followers: number | null
  items: CampaignDeliverableDetail[]
  campaignId: string
  reviewNotes: Record<string, string>
  setReviewNotes: React.Dispatch<React.SetStateAction<Record<string, string>>>
  pct: number
  avgRating: number | null
  ratedCount: number
  metrics: { views: number; likes: number; comments: number; avgEngagement: number | null } | null
}) {
  const [open, setOpen] = useState(false)

  // Estado por deliverable del grupo — para que el header diga "en revisión"
  // / "aprobado" en vez de solo el conteo, y se sepa sin abrir cuál necesita
  // acción. Reusa DEL_CONFIG (mismo label/color que ya se usa por deliverable).
  const statusCounts = items.reduce<Partial<Record<DeliverableStatus, number>>>((acc, d) => {
    acc[d.status] = (acc[d.status] ?? 0) + 1
    return acc
  }, {})
  const STATUS_ORDER: DeliverableStatus[] = ['in_review', 'rejected', 'pending', 'approved', 'published']
  const statusBadges = (
    <div className="flex items-center gap-1.5 flex-wrap justify-end">
      {STATUS_ORDER.filter(s => statusCounts[s]).map(s => (
        <span key={s} className={cn('badge text-[11px]', DEL_CONFIG[s].cls)}>
          {statusCounts[s]} {DEL_CONFIG[s].label.toLowerCase()}
        </span>
      ))}
    </div>
  )

  const scoreBlocks = (
    <>
      <StatBlock value={`${pct}%`} label="completado" />
      <StatBlock
        icon={Star}
        value={avgRating !== null ? avgRating.toFixed(1) : '—'}
        label={ratedCount > 0 ? `rating (${ratedCount})` : 'rating'}
      />
    </>
  )

  // Mismo formato de tarjeta (header + flechita para desplegar) sin importar
  // si el influencer tiene 1 o varios deliverables entregados — pedido de
  // Pri: "las que tienen 50% también deben tener el mismo formato que las
  // que completaron". Al desplegar, solo se listan los links ya entregados
  // (items ya viene filtrado a solo eso — nunca los pendientes).
  return (
    <div className="card p-2 space-y-1.5">
      <div className="flex items-center justify-between gap-3 cursor-pointer" onClick={() => setOpen(v => !v)}>
        <div className="flex items-center gap-3 flex-wrap">
          <InfluencerBadge influencer={influencer} igUsername={igUsername} />
          <FollowersStat followers={followers} />
          <ContentMetricsStats metrics={metrics} />
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {scoreBlocks}
          {statusBadges}
          <ChevronRight className={cn('h-4 w-4 text-gray-400 transition-transform', open ? 'rotate-90' : '')} />
        </div>
      </div>

      {open && (
        <div className="pt-1.5 border-t border-gray-50 divide-y divide-gray-50">
          {items.map(d => (
            <div key={d.id} className="py-2 first:pt-0 last:pb-0">
              <DeliverableContent d={d} campaignId={campaignId} reviewNotes={reviewNotes} setReviewNotes={setReviewNotes} />
            </div>
          ))}
        </div>
      )}
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

// ── Marcas colaboradoras (co-brands) ──────────────────────────────────────────
// Rediseñado 2026-07-12 (correcciones de Pri sobre la 1ra versión):
// - NO hay buscador abierto sobre toda la base de marcas — se busca únicamente
//   por email exacto (dedup), nunca se lista/expone el resto de la base.
// - Alta = { email, name } a POST /api/campaigns/[id]/brands:
//     · si el email ya es de una marca existente -> se asigna directo (matched).
//     · si no existe -> se crea una marca liviana + organización propia en
//       'pending_approval', SIN asignar todavía (pending). Admin la aprueba en
//       /admin-brands y ESO dispara la asignación automática (ver PATCH
//       /api/brands/[id]).
// - Nunca se acepta status='approved' desde acá.
// - Solo pinta name + logo — nunca contact_email/website/etc.
function CoBrandManager({
  campaignId,
  collaborators,
  canManage,
  onChanged,
}: {
  campaignId: string
  collaborators: Array<{ id: string; name?: string; logo_url?: string | null }>
  canManage: boolean
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())

  async function submit() {
    if (!emailValid || !name.trim()) return
    setSaving(true)
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/brands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), name: name.trim() }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      if (json.matched) {
        toast.success('Marca existente agregada como colaboradora')
        onChanged()
      } else {
        toast.success('Marca creada — queda pendiente de aprobación de Admin. Se asignará a la campaña automáticamente cuando se apruebe.')
      }
      setOpen(false)
      setEmail('')
      setName('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error agregando marca')
    }
    setSaving(false)
  }

  async function remove(brandId: string) {
    if (!confirm('¿Quitar esta marca colaboradora de la campaña?')) return
    setRemovingId(brandId)
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/brands?brand_id=${brandId}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Marca quitada')
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error quitando marca')
    }
    setRemovingId(null)
  }

  if (!canManage) return null

  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 text-xs font-semibold text-violet-600 hover:text-violet-700">
          <Plus className="h-3.5 w-3.5" /> Agregar marca colaboradora
        </button>
      ) : (
        <div className="space-y-2 bg-gray-50 rounded-xl p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500">Agregar marca colaboradora</span>
            <button type="button" onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Email del owner de la marca *</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="owner@marca.com"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:border-violet-400 bg-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nombre de la marca *</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Nombre de la marca"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:border-violet-400 bg-white"
            />
          </div>
          <p className="text-[11px] text-gray-400">
            Si ese email ya pertenece a una marca de SCENCE, se agrega directo. Si no, se crea una marca nueva pendiente de aprobación de Admin.
          </p>
          <button type="button" onClick={submit} disabled={saving || !emailValid || !name.trim()}
            className="w-full py-2 text-xs font-semibold bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50 flex items-center justify-center gap-2">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            {saving ? 'Guardando…' : 'Agregar'}
          </button>
        </div>
      )}

      {collaborators.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {collaborators.map(b => (
            <div key={b.id} className="flex items-center justify-between gap-2 text-xs px-2.5 py-1.5 bg-gray-50 rounded-lg">
              <span className="text-gray-600 truncate">{b.name}</span>
              <button type="button" onClick={() => remove(b.id)} disabled={removingId === b.id}
                className="text-red-500 hover:text-red-600 disabled:opacity-50 flex-shrink-0">
                {removingId === b.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function CampaignDetail({ id, defaultTab, portal = 'admin' }: { id: string; defaultTab?: Tab; portal?: 'admin' | 'brand' }) {
  const pathname = usePathname()
  const router = useRouter()
  const isBrandPortal = portal === 'brand' || pathname.startsWith('/brand')
  const apiBase = isBrandPortal ? '/api/brand/campaigns' : '/api/campaigns'
  const [tab, setTab] = useState<Tab>(defaultTab ?? 'overview')
  const [deletingCampaign, setDeletingCampaign] = useState(false)
  const [selectedInfluencerId, setSelectedInfluencerId] = useState<string | null>(null)
  const [brandRoster, setBrandRoster] = useState<Array<{
    id: string
    display_name: string
    avatar_url?: string | null
    city?: string | null
    country?: string | null
    social_profiles?: Array<{
      platform: string
      username: string | null
      followers: number | null
    }>
  }>>([])
  const [brandRosterLoading, setBrandRosterLoading] = useState(false)
  const [infSearch, setInfSearch] = useState('')
  const [infPlatform, setInfPlatform] = useState('')
  const [infStatus, setInfStatus] = useState('')
  const [ciVisibleColumns, setCiVisibleColumns] = useLocalStorageState<Record<CiColumnKey, boolean>>(
    'scence:admin:campaign-detail:influencers:visibleColumns', DEFAULT_CI_COLUMNS
  )
  function toggleCiColumn(key: CiColumnKey) {
    setCiVisibleColumns(prev => ({ ...prev, [key]: !prev[key] }))
  }
  // Selección para enviar recordatorio a varios influencers a la vez (no
  // uno-a-uno) — reusa el mismo endpoint /remind, solo dispara N fetches.
  const [remindSelection, setRemindSelection] = useState<Set<string>>(new Set())
  const [bulkSending, setBulkSending] = useState(false)

  async function handleBulkRemind() {
    const ids = Array.from(remindSelection)
    if (ids.length === 0) return
    setBulkSending(true)
    try {
      const results = await Promise.allSettled(
        ids.map(influencerId =>
          fetch(`/api/campaigns/${id}/deliverables/remind`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ influencer_id: influencerId }),
          }).then(async res => {
            if (!res.ok) throw new Error((await res.json())?.error || 'Error')
          })
        )
      )
      const ok = results.filter(r => r.status === 'fulfilled').length
      const failed = results.length - ok
      if (ok > 0) toast.success(`Recordatorio enviado a ${ok} influencer${ok !== 1 ? 's' : ''}`)
      if (failed > 0) toast.error(`${failed} recordatorio${failed !== 1 ? 's' : ''} no se pudo${failed !== 1 ? 'ieron' : ''} enviar`)
      setRemindSelection(new Set())
      void refetch()
    } finally {
      setBulkSending(false)
    }
  }
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({})
  const [notifying, setNotifying] = useState(false)
  const [notifyResult, setNotifyResult] = useState<{ sent: number; failed: number; remaining: number } | null>(null)
  const [addingDeliverable, setAddingDeliverable] = useState(false)
  const [addingInfluencerId, setAddingInfluencerId] = useState<string | null>(null)
  const [campaignInvoices, setCampaignInvoices] = useState<Array<Record<string, unknown>>>([])
  const [contractTemplates, setContractTemplates] = useState<Array<Record<string, unknown>>>([])
  const [brandLocations, setBrandLocations] = useState<Array<Record<string, unknown>>>([])
  const [campaignAssets, setCampaignAssets] = useState<Array<Record<string, unknown>>>([])
  const [assetName, setAssetName] = useState('')
  const [assetUrl, setAssetUrl] = useState('')
  const [assetMode, setAssetMode] = useState<'file' | 'link'>('file')
  const [assetFile, setAssetFile] = useState<File | null>(null)
  const [assetFormOpen, setAssetFormOpen] = useState(false)
  const [assetSaving, setAssetSaving] = useState(false)
  const [locationFormOpen, setLocationFormOpen] = useState(false)
  const [locationSaving, setLocationSaving] = useState(false)
  const [locationForm, setLocationForm] = useState({
    name: '',
    address: '',
    city: '',
    region: '',
    country: 'Chile',
    is_public: false,
    notes: '',
  })

  const { data: res, isLoading, error, refetch } = useCampaignDetail(id, apiBase)
  const patchCampaign = usePatchCampaign(id, apiBase)
  const removeInfluencer = useRemoveCampaignInfluencer(id)

  useEffect(() => {
    if (!isBrandPortal) return

    let cancelled = false
    setBrandRosterLoading(true)

    fetch('/api/brand/influencers?scope=roster&page=1&limit=5000')
      .then(async response => {
        const json = await response.json()
        if (!response.ok) {
          throw new Error(json.error ?? 'Error cargando influencers de la marca')
        }

        if (!cancelled) {
          setBrandRoster(Array.isArray(json.data) ? json.data : [])
        }
      })
      .catch(() => {
        if (!cancelled) setBrandRoster([])
      })
      .finally(() => {
        if (!cancelled) setBrandRosterLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [isBrandPortal])

  const campaignForEffects = res?.data as (CampaignDetail & { brand?: { id?: string } | null }) | undefined
  const primaryBrandId = campaignForEffects?.brand?.id

  useEffect(() => {
    let cancelled = false

    async function loadCampaignScopedData() {
      try {
        const [invoicesRes, templatesRes, assetsRes] = await Promise.all([
          fetch(`/api/invoices?campaign_id=${id}&limit=50`),
          fetch('/api/contracts/templates'),
          fetch(`/api/campaigns/${id}/assets`),
        ])

        const invoicesJson = await invoicesRes.json().catch(() => ({}))
        const templatesJson = await templatesRes.json().catch(() => ({}))
        const assetsJson = await assetsRes.json().catch(() => ({}))

        if (!cancelled) {
          setCampaignInvoices(Array.isArray(invoicesJson.data) ? invoicesJson.data : [])
          setContractTemplates(Array.isArray(templatesJson.data) ? templatesJson.data : [])
          setCampaignAssets(Array.isArray(assetsJson.data) ? assetsJson.data : [])
        }
      } catch {
        if (!cancelled) {
          setCampaignInvoices([])
          setContractTemplates([])
          setCampaignAssets([])
        }
      }
    }

    void loadCampaignScopedData()
    return () => { cancelled = true }
  }, [id])

  useEffect(() => {
    let cancelled = false

    async function loadBrandLocations() {
      if (!primaryBrandId) {
        setBrandLocations([])
        return
      }

      try {
        const res = await fetch(`/api/brands/${primaryBrandId}/locations`)
        const json = await res.json().catch(() => ({}))
        if (!cancelled) setBrandLocations(Array.isArray(json.data) ? json.data : [])
      } catch {
        if (!cancelled) setBrandLocations([])
      }
    }

    void loadBrandLocations()
    return () => { cancelled = true }
  }, [primaryBrandId])

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
        <Link href={isBrandPortal ? '/brand-campaigns' : '/admin-campaigns'} className="mt-4 inline-block text-sm text-violet-600 hover:underline">
          Volver a campañas
        </Link>
      </div>
    )
  }

  const c = res.data as CampaignDetail
  const campaignInfluencers     = c.campaign_influencers ?? []
  // Participantes reales = solo ACEPTadas. Se excluyen pending (postulantes/
  // invitadas sin aceptar) y rejected (no forman parte de la campaña).
  const confirmedInfluencers    = campaignInfluencers.filter(ci => ci.application_status === 'accepted')
  // Pendientes separadas por origen (NO se mezclan):
  //  - Solicitudes (postulaciones): la influencer postuló → la marca acepta/rechaza.
  //  - Invitaciones: la marca invitó → la influencer acepta/rechaza desde su portal.
  //    La marca NO ve botones Aceptar/Rechazar sobre una invitación.
  const pendingApplications = campaignInfluencers.filter(
    ci => ci.application_status === 'pending' && ci.origin === 'application'
  )
  const pendingInvitations = campaignInfluencers.filter(
    ci => ci.application_status === 'pending' && ci.origin === 'invitation'
  )
  // Relaciones activas de la campaña (aceptadas + pendientes; excluye rechazadas)
  // para el contador del tab — así no muestra 0 cuando hay invitaciones pendientes.
  const activeRelations = campaignInfluencers.filter(ci => ci.application_status !== 'rejected')
  const campaignInfluencerIds = new Set(
    campaignInfluencers
      .map(ci => ci.influencer?.id)
      .filter((value): value is string => Boolean(value))
  )
  const availableBrandRoster = brandRoster.filter(
    influencer => !campaignInfluencerIds.has(influencer.id)
  )

  // "Agregar" (preasignación): agrega la influencer a la campaña en UN paso,
  // sin abrir el formulario de oferta. Crea la relación pending reutilizando el
  // endpoint de invitación existente enviando SOLO influencer_id (sin fee,
  // mensaje ni entregables — se toman de la config general de la campaña). En
  // draft el email/notificación quedan diferidos (lógica del backend Batch 1).
  // El formulario de oferta se conserva solo para "Invitar con oferta".
  async function quickAddInfluencerToCampaign(influencerId: string) {
    if (addingInfluencerId) return
    setAddingInfluencerId(influencerId)
    try {
      const res = await fetch(`/api/brand/campaigns/${id}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ influencer_id: influencerId }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (json.code && String(json.code).startsWith('PLAN_LIMIT_')) {
          toast.error(json.error, { action: { label: 'Subir de plan', onClick: () => router.push('/brand-settings/plan') } })
        } else {
          toast.error(json.error ?? 'No se pudo agregar la influencer')
        }
        return
      }
      toast.success('Influencer agregada a la campaña (pendiente)')
      void refetch()
    } catch {
      toast.error('Error al agregar la influencer')
    } finally {
      setAddingInfluencerId(null)
    }
  }

  // Plataformas presentes entre las influencers confirmadas de esta campaña
  // (no una lista fija — evita mostrar opciones vacías en campañas con pocas plataformas).
  const infPlatformOptions = Array.from(new Set(
    confirmedInfluencers
      .map(ci => ci.influencer?.influencer_social_profiles?.[0]?.platform)
      .filter((p): p is string => !!p)
  )).sort()
  const filteredInfluencers = confirmedInfluencers.filter(ci => {
    const inf = ci.influencer
    if (!inf) return false
    if (infPlatform && inf.influencer_social_profiles?.[0]?.platform !== infPlatform) return false
    if (infStatus && (ci.status ?? 'draft') !== infStatus) return false
    if (infSearch.trim()) {
      const q = infSearch.trim().toLowerCase()
      const handle = inf.influencer_social_profiles?.[0]?.username ?? ''
      if (!inf.display_name.toLowerCase().includes(q) && !handle.toLowerCase().includes(q)) return false
    }
    return true
  })
  const infFiltersActive = !!(infSearch || infPlatform || infStatus)
  const campaignDeliverables = c.campaign_deliverables ?? []
  // IDs de influencers visibles (tras filtros) con al menos 1 pendiente en
  // esta campaña — usados para el checkbox "seleccionar todas" del recordatorio.
  const remindablePendingIds = filteredInfluencers
    .filter(ci => ci.influencer && campaignDeliverables.some(d =>
      d.influencer?.id === ci.influencer!.id && !isDeliverableComplete(d)
    ))
    .map(ci => ci.influencer!.id)
  // FIX: antes buscaba solo en confirmedInfluencers — clickear una postulante
  // pendiente en el panel de "solicitudes pendientes" no la encontraba (estaba
  // filtrada afuera) y el panel derecho caía silenciosamente a mostrar la
  // primera influencer confirmada en su lugar, sin ningún indicio del error.
  const selectedInfluencerCI = campaignInfluencers.find(ci => ci.influencer?.id === selectedInfluencerId) ?? confirmedInfluencers[0] ?? null
  const selectedInfluencer = selectedInfluencerCI?.influencer ?? null
  const selectedInfluencerDeliverables = selectedInfluencer
    ? campaignDeliverables.filter(d => d.influencer?.id === selectedInfluencer.id)
    : []

  // Solo cuenta deliverables con URL ya entregada — mismo criterio que el tab
  // Deliverables (que ya filtra por esto). Antes contaba los 148 templates
  // creados en bulk sin entrega, mostrando "Deliverables (148)" cuando en
  // realidad solo había 1 entregable real.
  const submittedForCount = campaignDeliverables.filter(d => d.content_url || d.published_url)
  const deliverableCount = submittedForCount.length
  const deliverableDone  = submittedForCount.filter(d => d.status === 'published').length
  // Average progress: published=100, others use progress field
  const avgProgress = deliverableCount > 0
    ? Math.round(submittedForCount.reduce((sum, d) => {
        if (d.status === 'published') return sum + 100
        return sum + (d.progress ?? 0)
      }, 0) / deliverableCount)
    : 0
  const pct = avgProgress
  const budgetPct = c.budget_total ? Math.round((c.budget_spent / c.budget_total) * 100) : 0

  // Métricas reales de contenido (Apify) agregadas a nivel campaña — solo
  // suma deliverables ya sincronizados (performance != null). No incluye
  // reach/impresiones/guardados/compartidos porque no existen (ver
  // src/lib/deliverables/apify-metrics.ts). Engagement siempre "calculado".
  const deliverablesWithMetrics = campaignDeliverables.filter(d => d.performance != null)
  const hasCampaignMetrics = deliverablesWithMetrics.length > 0
  const totalViews    = deliverablesWithMetrics.reduce((s, d) => s + (d.performance?.views ?? 0), 0)
  const totalLikes    = deliverablesWithMetrics.reduce((s, d) => s + (d.performance?.likes ?? 0), 0)
  const totalComments = deliverablesWithMetrics.reduce((s, d) => s + (d.performance?.comments ?? 0), 0)
  const totalInteractionsMetrics = totalLikes + totalComments
  const campaignEngagementRates = deliverablesWithMetrics
    .map(d => d.engagement_rate)
    .filter((v): v is number => v != null)
  const avgCampaignEngagement = campaignEngagementRates.length > 0
    ? Math.round((campaignEngagementRates.reduce((s, v) => s + v, 0) / campaignEngagementRates.length) * 100) / 100
    : null
  const campaignBrands = [
    c.brand ? { ...(c.brand as Record<string, unknown>), _role: 'Principal' } : null,
    ...(((c as unknown as { campaign_brands?: Array<{ brand?: Record<string, unknown> }> }).campaign_brands ?? [])
      .map(cb => cb.brand ? { ...cb.brand, _role: 'Colaboradora' } : null)),
  ].filter(Boolean) as Array<Record<string, unknown>>

  async function reloadCampaignAssets() {
    const res = await fetch(`/api/campaigns/${id}/assets`)
    const json = await res.json().catch(() => ({}))
    setCampaignAssets(Array.isArray(json.data) ? json.data : [])
  }

  async function handleAddCampaignAsset(e: React.FormEvent) {
    e.preventDefault()
    if (assetMode === 'link' && !assetUrl.trim()) {
      toast.error('Agrega una URL para el asset')
      return
    }

    if (assetMode === 'file' && !assetFile) {
      toast.error('Selecciona un archivo')
      return
    }

    setAssetSaving(true)
    try {
      let res: Response

      if (assetMode === 'file') {
        const formData = new FormData()
        if (assetName.trim()) formData.append('filename', assetName.trim())
        if (assetFile) formData.append('file', assetFile)

        res = await fetch(`/api/campaigns/${id}/assets`, {
          method: 'POST',
          body: formData,
        })
      } else {
        res = await fetch(`/api/campaigns/${id}/assets`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: assetName.trim() || assetUrl.trim(),
            url: assetUrl.trim(),
          }),
        })
      }
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Error al guardar asset')

      setAssetName('')
      setAssetUrl('')
      setAssetFile(null)
      setAssetFormOpen(false)
      await reloadCampaignAssets()
      toast.success('Asset agregado')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar asset')
    } finally {
      setAssetSaving(false)
    }
  }

  async function handleDeleteCampaignAsset(assetId: string) {
    if (!confirm('¿Eliminar este asset de la campaña?')) return

    const res = await fetch(`/api/campaigns/${id}/assets/${assetId}`, { method: 'DELETE' })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(json.error ?? 'Error al eliminar asset')
      return
    }

    await reloadCampaignAssets()
    toast.success('Asset eliminado')
  }

  async function reloadBrandLocations() {
    if (!primaryBrandId) {
      setBrandLocations([])
      return
    }

    const res = await fetch(`/api/brands/${primaryBrandId}/locations`)
    const json = await res.json().catch(() => ({}))
    setBrandLocations(Array.isArray(json.data) ? json.data : [])
  }

  async function handleAddBrandLocation(e: React.FormEvent) {
    e.preventDefault()

    if (!primaryBrandId) {
      toast.error('La campaña no tiene marca principal')
      return
    }

    if (!locationForm.name.trim()) {
      toast.error('Agrega el nombre del lugar')
      return
    }

    setLocationSaving(true)
    try {
      const res = await fetch(`/api/brands/${primaryBrandId}/locations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: locationForm.name.trim(),
          address: locationForm.address.trim() || null,
          city: locationForm.city.trim() || null,
          region: locationForm.region.trim() || null,
          country: locationForm.country.trim() || 'Chile',
          is_public: locationForm.is_public,
          notes: locationForm.notes.trim() || null,
        }),
      })

      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Error al crear lugar')

      setLocationForm({
        name: '',
        address: '',
        city: '',
        region: '',
        country: 'Chile',
        is_public: false,
        notes: '',
      })
      setLocationFormOpen(false)
      await reloadBrandLocations()
      toast.success('Lugar agregado')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al crear lugar')
    } finally {
      setLocationSaving(false)
    }
  }

  function handleBack() {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
      return
    }

    router.push(isBrandPortal ? '/brand-campaigns' : '/admin-campaigns')
  }

  async function handleStatusAction(action: string) {
    const brandStatusByAction: Record<string, string> = {
      activate: 'active',
      pause: 'paused',
      complete: 'completed',
    }

    const payload =
      isBrandPortal && brandStatusByAction[action]
        ? { status: brandStatusByAction[action] }
        : { action }

    try {
      await patchCampaign.mutateAsync(payload)
      toast.success(action === 'activate' ? 'Campaña activada' : 'Estado actualizado')
    } catch {
      // El hook muestra el error.
    }
  }

  // Selector de estado inline (solo admin) — permite ir a cualquier estado,
  // incluido "draft", sin pasar por la página /edit. Reusa las acciones
  // nombradas del PATCH cuando existen para no perder sus side-effects
  // (auto-factura al completar, avisos a influencers al activar); para
  // "draft" —que no tiene acción asociada— se manda el status directo,
  // que el backend ya acepta (ver PATCH /api/campaigns/[id]).
  const STATUS_TO_ACTION: Partial<Record<CampaignStatus, string>> = {
    active:           'activate',
    paused:           'pause',
    completed:        'complete',
    canceled:         'cancel',
    pending_approval: 'submit_for_approval',
  }

  async function handleStatusChange(newStatus: CampaignStatus) {
    if (newStatus === c.status || patchCampaign.isPending) return
    const action = STATUS_TO_ACTION[newStatus]
    const payload = action ? { action } : { status: newStatus }

    try {
      await patchCampaign.mutateAsync(payload)
      toast.success(`Estado cambiado a "${campaignStatusLabel(newStatus)}"`)
    } catch {
      // El hook muestra el error.
    }
  }

  async function handleDeleteCampaign() {
    if (!confirm(`¿Eliminar la campaña "${c.name}"? Quedará marcada como Cancelada (no se borra la data). Esta acción no se puede deshacer desde la interfaz.`)) return
    setDeletingCampaign(true)
    try {
      const r = await fetch(`/api/campaigns/${id}`, { method: 'DELETE' })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.error ?? 'Error al eliminar la campaña')
      }
      toast.success('Campaña eliminada')
      router.push(isBrandPortal ? '/brand-campaigns' : '/admin-campaigns')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al eliminar la campaña')
      setDeletingCampaign(false)
    }
  }

  async function handleHardDeleteCampaign() {
    if (!confirm(`¿Borrar la campaña "${c.name}" de forma PERMANENTE?\n\nSe eliminarán también los influencers asignados, deliverables, assets y notificaciones de esta campaña.\n\nEsta acción NO se puede deshacer.`)) return
    setDeletingCampaign(true)
    try {
      let r = await fetch(`/api/campaigns/${id}?hard=1`, { method: 'DELETE' })
      if (r.status === 409) {
        const info = await r.json().catch(() => ({} as { facturas?: number; payroll?: number }))
        const partes = [
          info.facturas ? `${info.facturas} factura(s)` : null,
          info.payroll ? `${info.payroll} registro(s) de payroll` : null,
        ].filter(Boolean).join(' y ')
        const ok = confirm(`Esta campaña tiene ${partes} asociado(s).\n\nAl borrarla, esos registros financieros se conservan pero quedan sin campaña asociada.\n\n¿Confirmas el borrado permanente?`)
        if (!ok) { setDeletingCampaign(false); return }
        r = await fetch(`/api/campaigns/${id}?hard=1`, { method: 'DELETE', headers: { 'x-confirm-billing': '1' } })
      }
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.error ?? 'Error al borrar la campaña')
      }
      toast.success('Campaña borrada permanentemente')
      router.push(isBrandPortal ? '/brand-campaigns' : '/admin-campaigns')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al borrar la campaña')
      setDeletingCampaign(false)
    }
  }

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'overview',     label: 'Overview',      icon: <Target className="h-3.5 w-3.5" /> },
    { id: 'influencers',  label: `Influencers (${activeRelations.length})`, icon: <Users className="h-3.5 w-3.5" /> },
    { id: 'deliverables', label: `Deliverables (${deliverableCount})`,           icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
    { id: 'assets',       label: `Assets (${campaignAssets.length})`, icon: <FileText className="h-3.5 w-3.5" /> },
    { id: 'locations',    label: `Lugares (${brandLocations.length})`, icon: <Target className="h-3.5 w-3.5" /> },
    { id: 'billing',      label: `Facturas (${campaignInvoices.length})`, icon: <DollarSign className="h-3.5 w-3.5" /> },
    { id: 'history',      label: 'Historial',     icon: <Clock className="h-3.5 w-3.5" /> },
  ]

  return (
    <div className="space-y-5">
      {/* Breadcrumb + actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleBack}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" /> Volver
          </button>
          <span className="text-gray-200">/</span>
          <span className="text-sm font-semibold text-gray-800 truncate max-w-[240px]">{c.name}</span>
        </div>
        <div className="flex items-center gap-2">
          <Link href={isBrandPortal ? `/brand-campaigns/${id}/report` : `/admin-campaigns/${id}/report`} target="_blank" rel="noopener noreferrer"
            title="Reporte PDF"
            className="flex items-center justify-center p-2 text-violet-700 bg-violet-50 border border-violet-200 rounded-lg hover:bg-violet-100 transition-colors">
            <FileDown className="h-3.5 w-3.5" />
          </Link>
          {/* Editar: en portal marca solo la marca creadora puede editar —
              mismo criterio que ya usa el panel de postulaciones más abajo
              (_brand_permissions.canEdit). Antes se mostraba siempre, aunque
              el backend igual lo rechazaba con 403 al guardar. */}
          {(!isBrandPortal || c._brand_permissions?.canEdit) && (
            <Link href={isBrandPortal ? `/brand-campaigns/${id}/edit` : `/admin-campaigns/${id}/edit`}
              title="Editar campaña"
              className="flex items-center justify-center p-2 text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
              <Pencil className="h-3.5 w-3.5" />
            </Link>
          )}
          {c.status === 'draft' && (
            isBrandPortal ? (
              <button
                onClick={() => handleStatusAction('activate')}
                disabled={patchCampaign.isPending}
                title="Activar campaña"
                className="flex items-center gap-1.5 px-3 py-2 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 disabled:opacity-50 transition-colors"
              >
                <Play className="h-3.5 w-3.5" />
                <span className="text-xs font-semibold">Activar</span>
              </button>
            ) : (
              <button
                onClick={() => handleStatusAction('submit_for_approval')}
                disabled={patchCampaign.isPending}
                title="Enviar a aprobación"
                className="flex items-center justify-center p-2 text-violet-700 bg-violet-50 border border-violet-200 rounded-lg hover:bg-violet-100 disabled:opacity-50 transition-colors"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
            )
          )}
          {(c.status === 'pending_approval' || c.status === 'paused') && (
            <button onClick={() => handleStatusAction('activate')} disabled={patchCampaign.isPending}
              title={c.status === 'paused' ? 'Reactivar' : 'Activar'}
              className="flex items-center justify-center p-2 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 disabled:opacity-50 transition-colors">
              <Play className="h-3.5 w-3.5" />
            </button>
          )}
          {c.status === 'active' && (
            <>
              <button onClick={() => handleStatusAction('pause')} disabled={patchCampaign.isPending}
                title="Pausar campaña"
                className="flex items-center justify-center p-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 disabled:opacity-50 transition-colors">
                <Pause className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => handleStatusAction('complete')} disabled={patchCampaign.isPending}
                title="Marcar campaña como completada"
                className="flex items-center justify-center p-2 text-white bg-violet-600 rounded-lg hover:bg-violet-700 disabled:opacity-50 transition-colors">
                <Check className="h-3.5 w-3.5" />
              </button>
            </>
          )}
          {c.status === 'completed' && (
            <button onClick={() => handleStatusAction('activate')} disabled={patchCampaign.isPending}
              title="Reabrir campaña"
              className="flex items-center justify-center p-2 text-violet-700 bg-violet-50 border border-violet-200 rounded-lg hover:bg-violet-100 disabled:opacity-50 transition-colors">
              <Play className="h-3.5 w-3.5" />
            </button>
          )}
          {!isBrandPortal && c.status !== 'canceled' && (
            <button onClick={handleDeleteCampaign} disabled={deletingCampaign}
              title="Eliminar: marca la campaña como Cancelada (no borra datos)"
              className="flex items-center justify-center p-2 text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50 transition-colors">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          {!isBrandPortal && (
            <button onClick={handleHardDeleteCampaign} disabled={deletingCampaign}
              title="Borrar todo: borrado permanente de la campaña y sus datos — no se puede deshacer"
              className="flex items-center justify-center p-2 text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Header card — compacto (pedido de Pri: "sigue muy grande, achicar") */}
      <div className="card p-3">
        <div className="flex flex-col sm:flex-row sm:items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-violet-100 flex items-center justify-center flex-shrink-0">
            <Target className="h-4 w-4 text-violet-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-base font-bold text-gray-900 tracking-tight truncate">{c.name}</h1>
              {isBrandPortal ? (
                <CampaignStatusBadge status={c.status} />
              ) : (
                <div className="relative inline-flex">
                  <select
                    value={c.status}
                    disabled={patchCampaign.isPending}
                    onChange={e => handleStatusChange(e.target.value as CampaignStatus)}
                    title="Cambiar estado de la campaña"
                    className={cn(
                      'badge appearance-none cursor-pointer pr-5 border-0 focus:outline-none focus:ring-2 focus:ring-violet-300 disabled:opacity-50 disabled:cursor-not-allowed',
                      campaignStatusBadgeClass(c.status)
                    )}
                  >
                    {CAMPAIGN_STATUS_OPTIONS.map(s => (
                      <option key={s} value={s}>{campaignStatusLabel(s)}</option>
                    ))}
                  </select>
                  <ChevronDown className="h-3 w-3 pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 opacity-60" />
                </div>
              )}
              <span className="badge badge-gray capitalize text-[10px]">{c.type.replace(/_/g, ' ')}</span>
            </div>
            {c.description && <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{c.description}</p>}
            <div className="flex items-center gap-3 flex-wrap text-xs text-gray-500 mt-1">
              {c.start_date && (
                <span className="flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5 text-violet-500" />
                  {formatDate(c.start_date)} → {c.end_date ? formatDate(c.end_date) : '—'}
                </span>
              )}
              <span className="flex items-center gap-1">
                <DollarSign className="h-3.5 w-3.5 text-gray-300" />
                <strong className="text-gray-800">{formatCurrency(c.budget_total ?? 0, c.currency)}</strong>
              </span>
              <span className="flex items-center gap-1">
                <Users className="h-3.5 w-3.5 text-gray-300" />
                <strong className="text-gray-800">{campaignInfluencers.length}</strong> influencers
              </span>
              {c.address && (
                <span className="flex items-center gap-1 min-w-0">
                  <MapPin className="h-3.5 w-3.5 text-gray-300 flex-shrink-0" />
                  <span className="truncate max-w-[220px]">{c.address}</span>
                </span>
              )}
              {c.brief_url && (
                <a href={c.brief_url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 text-violet-600 hover:underline">
                  <FileText className="h-3.5 w-3.5" /> Brief
                </a>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 w-full sm:w-auto sm:max-w-[380px] sm:justify-end sm:flex-shrink-0" style={{ minWidth: 0 }}>
            <div className="text-center bg-gray-50 rounded-md p-1.5 w-[76px] flex-shrink-0">
              <div className="text-sm font-bold text-gray-900">{pct}%</div>
              <div className="text-[9px] text-gray-400">Completado</div>
            </div>
            {!!c.budget_total && (
              <div className="text-center bg-gray-50 rounded-md p-1.5 w-[76px] flex-shrink-0">
                <div className="text-sm font-bold text-gray-900">{budgetPct}%</div>
                <div className="text-[9px] text-gray-400">Budget usado</div>
              </div>
            )}
            <div className="text-center bg-gray-50 rounded-md p-1.5 w-[76px] flex-shrink-0">
              <div className="text-sm font-bold text-gray-900">{campaignInfluencers.length}</div>
              <div className="text-[9px] text-gray-400">Invitadas</div>
            </div>
            <div className="text-center bg-violet-50 rounded-md p-1.5 w-[76px] flex-shrink-0">
              <div className="text-[11px] font-bold text-violet-700 truncate">
                {((c as { visibility?: string | null }).visibility === 'open' || (c as { visibility?: string | null }).visibility === 'public') ? 'Pública' : 'Invitación'}
              </div>
              <div className="text-[9px] text-violet-400">Visibilidad</div>
            </div>
            {/* Comisión — Pri: "esto es importantisimo y deberia aparecer en la
                card de arriba... donde aparece el resumen". Antes solo vivía
                como card aparte en el Overview, fácil de perder de vista. Ahora
                está en el resumen principal, junto a Completado/Budget/Invitadas. */}
            {!!c.commission_rate && (
              <div className="text-center bg-amber-50 rounded-md p-1.5 w-[76px] flex-shrink-0">
                <div className="text-sm font-bold text-amber-700">{c.commission_rate}%</div>
                <div className="text-[9px] text-amber-500">Comisión</div>
              </div>
            )}
            {/* Métricas reales de contenido (Apify) — solo aparecen si al menos
                1 deliverable ya fue sincronizado con "Actualizar métricas".
                Views/likes/comments reales; engagement calculado por nosotros.
                Cajas achicadas (pedido de Pri: "sigue muy grande, achicar"). */}
            {hasCampaignMetrics && (
              <>
                <div className="text-center bg-gray-50 rounded-md p-1.5 w-[76px] flex-shrink-0">
                  <div className="text-sm font-bold text-gray-900">{formatFollowers(totalViews)}</div>
                  <div className="text-[9px] text-gray-400">Visualiz.</div>
                </div>
                <div className="text-center bg-gray-50 rounded-md p-1.5 w-[76px] flex-shrink-0">
                  <div className="text-sm font-bold text-gray-900">{formatFollowers(totalInteractionsMetrics)}</div>
                  <div className="text-[9px] text-gray-400">Interacc.</div>
                </div>
                <div className="text-center bg-violet-50 rounded-md p-1.5 w-[76px] flex-shrink-0">
                  <div className="text-sm font-bold text-violet-700">{avgCampaignEngagement !== null ? `${avgCampaignEngagement}%` : '—'}</div>
                  <div className="text-[9px] text-violet-400">Eng. (calc.)</div>
                </div>
              </>
            )}
          </div>
        </div>
        <div className="mt-2 pt-2 border-t border-gray-100">
          <div className="flex justify-between text-[11px] text-gray-400 mb-1">
            <span>{deliverableDone}/{deliverableCount} deliverables publicados</span>
            <span>{formatCurrency(c.budget_spent, c.currency)} gastados de {formatCurrency(c.budget_total ?? 0, c.currency)}</span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className={cn('h-full rounded-full transition-all', pct === 100 ? 'bg-emerald-500' : 'bg-violet-500')}
              style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      {/* Tabs — achicados (pedido de Pri: "arregla la ui que se vea bien") */}
      <div className="border-b border-gray-200">
        <div className="flex gap-1 overflow-x-auto">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-b-2 transition-all -mb-px whitespace-nowrap',
                tab === t.id ? 'border-violet-600 text-violet-700' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              )}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── OVERVIEW ───────────────────────────────────────────────────────── */}
      {tab === 'overview' && (
        <>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          <div className="col-span-2 space-y-4">
            {/* Guías de contenido — movida arriba (antes al final de la columna,
                casi invisible después de scrollear). Pri: "necesito que al abrir
                el overview lo entienda por completo las marcas... las guías de
                contenido" — es lo primero que una marca necesita leer para saber
                qué se espera de la campaña. */}
            {c.address && (
              <div className="card p-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-violet-500" /> Ubicación
                </h3>
                <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{c.address}</p>
              </div>
            )}

            {c.content_guidelines && (
              <div className="card p-5 border-2 border-violet-100 bg-violet-50/20">
                <h3 className="text-sm font-semibold text-violet-800 mb-2 flex items-center gap-2">
                  <FileText className="h-4 w-4" /> Guías de contenido
                </h3>
                <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{c.content_guidelines}</p>
              </div>
            )}

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
                  <div className="flex flex-wrap gap-2 mb-3">
                    {c.hashtags?.map(h => (
                      <span key={h} className="px-2.5 py-1 bg-violet-50 text-violet-700 rounded-md text-xs font-medium">{h}</span>
                    ))}
                  </div>
                )}
                {/* Tags internos — antes vivía en una card aparte en el sidebar
                    ("Tags"), duplicando el concepto de "tags" ya presente acá
                    (hashtags/social_tags). Se fusiona todo en 1 sola card. */}
                {(c.tags?.length ?? 0) > 0 && (
                  <div>
                    <p className="text-xs text-gray-400 mb-1.5 font-medium">Tags internos:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {c.tags?.map(t => <span key={t} className="badge badge-gray">{t}</span>)}
                    </div>
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

            {/* Marca(s) — antes existían 2 cards separadas ("Marca" acá arriba con
                solo la principal, y "Marcas" al fondo con la lista completa, solo
                admin). Se consolida en 1 sola card con marca principal +
                colaboradoras. Visible en ambos portales: solo se muestra nombre
                y rol de las colaboradoras (nunca datos comerciales sensibles),
                consistente con la regla de permisos de marca. */}
            {(campaignBrands.length > 0 || (!isBrandPortal || c._brand_permissions?.canEdit)) && (
              <div className="card p-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  🏢 {campaignBrands.length > 1 ? 'Marcas' : 'Marca'}
                </h3>
                {campaignBrands.length > 0 && (
                  <div className="space-y-2">
                    {campaignBrands.map((brand, idx) => (
                      <div key={`${brand.id ?? idx}`} className="flex items-center justify-between gap-3 bg-gray-50 rounded-xl px-3 py-2">
                        <div className="flex items-center gap-3 min-w-0">
                          {!!brand.logo_url && (
                            <img src={String(brand.logo_url)} alt={String(brand.name)}
                              className="w-8 h-8 rounded-lg object-contain border border-gray-100 p-0.5 flex-shrink-0" />
                          )}
                          <span className="font-semibold text-gray-900 truncate">{String(brand.name ?? 'Marca sin nombre')}</span>
                        </div>
                        <span className="text-xs text-gray-400 flex-shrink-0">{String(brand._role ?? '')}</span>
                      </div>
                    ))}
                  </div>
                )}
                {/* Gestión de colaboradoras: solo la marca principal (o admin) puede
                    agregar/quitar — mismo gate que el resto de acciones de edición
                    del componente. Una co-marca invitada ve la lista de arriba pero
                    no ve este bloque de gestión. */}
                <CoBrandManager
                  campaignId={id}
                  collaborators={campaignBrands
                    .filter(b => b._role === 'Colaboradora')
                    .map(b => ({ id: String(b.id), name: String(b.name ?? ''), logo_url: b.logo_url as string | null }))}
                  canManage={!isBrandPortal || c._brand_permissions?.canEdit === true}
                  onChanged={() => void refetch()}
                />
              </div>
            )}
            {/* Visibility badge — solo admin. El estado (Pública/Por invitación) ya
                se ve en el header (stat tile), esta card era una segunda
                explicación del mismo dato; se deja solo donde hace falta el
                control real (el toggle), que es exclusivamente admin. */}
            {!isBrandPortal && (
            <div className="card p-4 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-gray-700">Visibilidad</h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  {(c as {visibility?: string}).visibility === 'open'
                    ? 'Las influencers pueden postular desde su portal'
                    : 'Solo por invitación del equipo'}
                </p>
              </div>
              <button
                onClick={async () => {
                  // FIX (2026-07-01): antes escribía 'public'/'invite_only', valores
                  // que ningún otro endpoint reconoce (visibility es texto libre, sin
                  // enum en BD). El resto del sistema (incl. GET /api/influencer/
                  // campaigns/open) usa 'open'/'private'. Este botón nunca había sido
                  // usado en producción (0 filas con 'public' hoy), pero de haberse
                  // usado, la campaña habría dejado de aparecer para influencers sin
                  // ningún error visible.
                  const current = (c as {visibility?: string}).visibility ?? 'private'
                  const next = current === 'open' ? 'private' : 'open'
                  await fetch(`/api/campaigns/${id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ visibility: next }),
                  })
                  void refetch()
                }}
                className={cn(
                  'text-xs font-bold px-3 py-1.5 rounded-full border transition-colors',
                  (c as {visibility?: string}).visibility === 'open'
                    ? 'bg-green-100 text-green-700 border-green-200 hover:bg-green-200'
                    : 'bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-200'
                )}
              >
                {(c as {visibility?: string}).visibility === 'open' ? '🌐 Pública' : '🔒 Invitación'}
              </button>
            </div>
            )}

            {!isBrandPortal && (c as {visibility?: string}).visibility === 'open' && (
              <div className="card p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700">Notificar influencers</h3>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Envía un email a las siguientes 50 influencers con más seguidores que aún no fueron notificadas de esta campaña
                    </p>
                  </div>
                  <button
                    disabled={notifying}
                    onClick={async () => {
                      setNotifying(true)
                      setNotifyResult(null)
                      try {
                        const r = await fetch(`/api/campaigns/${id}/notify-influencers`, { method: 'POST' })
                        const json = await r.json()
                        if (!r.ok) throw new Error(json.error ?? 'Error al notificar')
                        setNotifyResult(json)
                        if (json.sent > 0) toast.success(`Email enviado a ${json.sent} influencer(s)`)
                        else toast.success(json.message ?? 'No quedan influencers elegibles')
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : 'Error al notificar')
                      }
                      setNotifying(false)
                    }}
                    className="flex items-center gap-2 text-xs font-bold px-4 py-2 rounded-full bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 whitespace-nowrap"
                  >
                    {notifying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    Notificar siguiente batch
                  </button>
                </div>
                {notifyResult && (
                  <p className="text-xs text-gray-500 mt-3 pt-3 border-t border-gray-100">
                    Enviados: <strong className="text-gray-700">{notifyResult.sent}</strong>
                    {notifyResult.failed > 0 && <> · Fallidos: <strong className="text-red-500">{notifyResult.failed}</strong></>}
                    {' · '}Quedan por notificar: <strong className="text-gray-700">{notifyResult.remaining}</strong>
                  </p>
                )}
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

            <div className="card p-4 space-y-2">
              <h3 className="text-sm font-semibold text-gray-700 mb-1">Acciones rápidas</h3>
              {[
                { label: '+ Agregar influencer', href: isBrandPortal ? `/brand-campaigns/${id}/invite` : `/admin-campaigns/${id}/influencers/add`, color: 'text-violet-700 bg-violet-50 hover:bg-violet-100' },
                { label: '📄 Ver contratos',      href: `/admin-contracts`,  color: 'text-gray-700 bg-gray-50 hover:bg-gray-100' },
                { label: '💳 Crear factura',      href: `/admin-billing`,    color: 'text-gray-700 bg-gray-50 hover:bg-gray-100' },
                { label: '💸 Crear payroll run',  href: `/admin-billing`,    color: 'text-gray-700 bg-gray-50 hover:bg-gray-100' },
              ].map(({ label, href, color }) => (
                <Link key={label} href={href} className={cn('block w-full px-3 py-2 rounded-lg text-sm font-medium transition-colors', color)}>
                  {label}
                </Link>
              ))}
            </div>
          </div>
        </div>

        {/* NOTA (2026-07-04, redesign Overview): antes había un 2do grid acá abajo
            con 4 cards más (Marcas, Assets, Contratos, Canjes) — Pri: "hay varios
            widgets que estan de mas porque existen tabs especificos". Se quitó
            completo:
            - Marcas: se fusionó con la card "Marca(s)" de arriba (ya no hay 2
              widgets separados mostrando lo mismo).
            - Assets: duplicaba 1:1 el tab Assets (que ya tiene su conteo en la
              barra de tabs) — se elimina, el tab ya cumple esa función.
            - Contratos y Canjes: eran resúmenes de secciones que ni siquiera
              están activas hoy (las secciones reales de Contratos/Canjes en
              este archivo están bajo `{false && (...)}`, es decir, código
              muerto) — no aportaban nada real, solo texto estático o datos de
              plantillas genéricas sin relación con esta campaña puntual. */}

        </>

      )}

      {/* ── INFLUENCERS ─────────────────────────────────────────────────────── */}
      {tab === 'influencers' && (
        <div className="space-y-4">
          {/* Pending applications (fix 2026-07-01: filtraba por ci.status === 'applied',
              un valor que el flujo real de postulación nunca setea — el campo correcto
              es application_status. Ver src/lib/campaign-applications.ts)

              FIX (2026-07-02, permisos): en Marca este panel y sus botones Aceptar/Rechazar
              pegaban siempre a /api/campaigns/[id]/applications (endpoint Admin, solo valida
              organization_id) en vez de /api/brand/campaigns/[id]/applications (que sí valida
              brand_id). En una organización con más de una marca (hoy solo "Scence SpA" tiene
              ese caso) una marca colaboradora podía aprobar/rechazar postulaciones de una
              campaña que no creó. Regla de Pri: "solo la marca que creó la campaña puede
              aprobar y ver quién postuló" — ahora el panel completo (no solo los botones) se
              oculta en Marca si _brand_permissions.canEdit es false, y los botones pegan al
              endpoint correcto según el portal. */}
          {pendingApplications.length > 0
            && (!isBrandPortal || c._brand_permissions?.canEdit) && (
            <div className="card p-4 border-amber-200 bg-amber-50">
              <p className="text-xs font-bold text-amber-700 uppercase tracking-wider mb-3 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                {pendingApplications.length} solicitud(es) pendiente(s)
              </p>
              <div className="space-y-2">
                {pendingApplications.map(ci => {
                  const inf = ci.influencer
                  if (!inf) return null
                  const primarySP = inf.influencer_social_profiles?.[0]
                  const igUrl = primarySP?.username ? buildProfileUrl(primarySP.platform, primarySP.username) : null
                  const applicationsEndpoint = isBrandPortal
                    ? `/api/brand/campaigns/${id}/applications`
                    : `/api/campaigns/${id}/applications`
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
                        <button
                          type="button"
                          onClick={() => setSelectedInfluencerId(inf.id)}
                          className="text-left text-sm font-semibold text-gray-900 hover:text-violet-700"
                        >
                          {inf.display_name}
                        </button>
                        <p className="text-xs text-gray-400 truncate">
                          {[inf.city, inf.country].filter(Boolean).join(', ') || 'Sin ubicación'}
                          {primarySP?.username && (
                            <>
                              {' · '}
                              {igUrl ? (
                                <a
                                  href={igUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={e => e.stopPropagation()}
                                  className="text-violet-600 hover:underline"
                                >
                                  {PLATFORM_ICONS[primarySP.platform] ?? ''} @{primarySP.username}
                                </a>
                              ) : (
                                <span>{PLATFORM_ICONS[primarySP.platform] ?? ''} @{primarySP.username}</span>
                              )}
                              {' · '}{((primarySP.followers ?? 0)/1000).toFixed(0)}K
                            </>
                          )}
                        </p>
                      </div>
                      <div className="flex gap-2 flex-shrink-0">
                        <button
                          onClick={async () => {
                            const res = await fetch(applicationsEndpoint, {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ application_id: ci.id, action: 'accept' }),
                            })
                            if (res.ok) toast.success(`Postulación de ${inf.display_name} aceptada — se le notificó por email`)
                            else toast.error('Error al aceptar la postulación')
                            void refetch()
                          }}
                          className="text-xs font-bold bg-green-600 text-white px-3 py-1 rounded-lg hover:bg-green-700"
                        >
                          Aceptar
                        </button>
                        <button
                          onClick={async () => {
                            if (!confirm(`¿Rechazar la solicitud de ${inf.display_name}?`)) return
                            const res = await fetch(applicationsEndpoint, {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ application_id: ci.id, action: 'reject' }),
                            })
                            if (!res.ok) toast.error('Error al rechazar la postulación')
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

          {/* Invitaciones pendientes (origin='invitation'): la marca invitó; la
              influencer acepta/rechaza desde su portal cuando la campaña esté
              activa. La marca NO ve botones Aceptar/Rechazar acá — solo el badge. */}
          {pendingInvitations.length > 0
            && (!isBrandPortal || c._brand_permissions?.canEdit) && (
            <div className="card p-4 border-violet-200 bg-violet-50">
              <p className="text-xs font-bold text-violet-700 uppercase tracking-wider mb-1 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-violet-500" />
                {pendingInvitations.length} invitación(es) pendiente(s)
              </p>
              <p className="text-[11px] text-violet-500 mb-3">
                La influencer acepta o rechaza desde su portal cuando la campaña esté activa.
              </p>
              <div className="space-y-2">
                {pendingInvitations.map(ci => {
                  const inf = ci.influencer
                  if (!inf) return null
                  const primarySP = inf.influencer_social_profiles?.[0]
                  const igUrl = primarySP?.username ? buildProfileUrl(primarySP.platform, primarySP.username) : null
                  return (
                    <div key={ci.id} className="flex items-center gap-3 bg-white rounded-xl p-3 border border-violet-100">
                      {inf.avatar_url ? (
                        <img src={inf.avatar_url} alt={inf.display_name} className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                          {inf.display_name.charAt(0)}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <button
                          type="button"
                          onClick={() => setSelectedInfluencerId(inf.id)}
                          className="text-left text-sm font-semibold text-gray-900 hover:text-violet-700"
                        >
                          {inf.display_name}
                        </button>
                        <p className="text-xs text-gray-400 truncate">
                          {[inf.city, inf.country].filter(Boolean).join(', ') || 'Sin ubicación'}
                          {primarySP?.username && (
                            <>
                              {' · '}
                              {igUrl ? (
                                <a href={igUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-violet-600 hover:underline">
                                  {PLATFORM_ICONS[primarySP.platform] ?? ''} @{primarySP.username}
                                </a>
                              ) : (
                                <span>{PLATFORM_ICONS[primarySP.platform] ?? ''} @{primarySP.username}</span>
                              )}
                              {' · '}{((primarySP.followers ?? 0)/1000).toFixed(0)}K
                            </>
                          )}
                        </p>
                      </div>
                      <span className="text-xs font-semibold text-violet-700 bg-violet-100 px-2.5 py-1 rounded-full flex-shrink-0">
                        Pendiente
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-500">
              {infFiltersActive ? `${filteredInfluencers.length} de ${confirmedInfluencers.length}` : confirmedInfluencers.length} influencer{confirmedInfluencers.length !== 1 ? 's' : ''} asignado{confirmedInfluencers.length !== 1 ? 's' : ''}
            </p>
            <div className="flex items-center gap-2">
              {remindSelection.size > 0 && (
                <button
                  onClick={handleBulkRemind}
                  disabled={bulkSending}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors disabled:opacity-50"
                >
                  {bulkSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                  Enviar recordatorio ({remindSelection.size})
                </button>
              )}
              <Link href={isBrandPortal ? `/brand-campaigns/${id}/invite` : `/admin-campaigns/${id}/influencers/add`}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-white bg-violet-600 rounded-lg hover:bg-violet-700 transition-colors">
                + Agregar influencer
              </Link>
            </div>
          </div>

          {isBrandPortal && (
            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100">
                <h3 className="text-sm font-semibold text-gray-800">
                  Influencers de tu marca
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  Agrega a esta campaña una influencer que ya pertenece a tu roster.
                </p>
              </div>

              {brandRosterLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-violet-500" />
                </div>
              ) : availableBrandRoster.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <p className="text-sm text-gray-400">
                    No hay más influencers disponibles en tu roster.
                  </p>
                  <Link
                    href="/brand-influencers/new"
                    className="inline-block mt-3 text-sm font-semibold text-violet-600 hover:underline"
                  >
                    + Agregar influencer a mi marca
                  </Link>
                </div>
              ) : (
                <div className="divide-y divide-gray-100 max-h-[420px] overflow-y-auto">
                  {availableBrandRoster.map(influencer => {
                    const primary = influencer.social_profiles?.[0]

                    return (
                      <div
                        key={influencer.id}
                        className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50"
                      >
                        {influencer.avatar_url ? (
                          <img
                            src={influencer.avatar_url}
                            alt={influencer.display_name}
                            className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-violet-100 text-violet-600 flex items-center justify-center font-bold flex-shrink-0">
                            {influencer.display_name.charAt(0).toUpperCase()}
                          </div>
                        )}

                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">
                            {influencer.display_name}
                          </p>
                          <p className="text-xs text-gray-400 truncate">
                            {primary?.username
                              ? `@${primary.username.replace(/^@/, '')}`
                              : [influencer.city, influencer.country]
                                  .filter(Boolean)
                                  .join(', ') || 'Sin red registrada'}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => quickAddInfluencerToCampaign(influencer.id)}
                          disabled={addingInfluencerId === influencer.id}
                          className="px-3 py-1.5 text-xs font-semibold text-white bg-violet-600 rounded-lg hover:bg-violet-700 disabled:opacity-60"
                        >
                          {addingInfluencerId === influencer.id ? 'Agregando…' : 'Agregar'}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {confirmedInfluencers.length > 0 && (
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Buscar por nombre o @usuario..."
                  value={infSearch}
                  onChange={e => setInfSearch(e.target.value)}
                  className="input-base pl-9"
                />
                {infSearch && (
                  <button onClick={() => setInfSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {infPlatformOptions.length > 0 && (
                <div className="relative">
                  <select
                    value={infPlatform}
                    onChange={e => setInfPlatform(e.target.value)}
                    className={cn('input-base appearance-none pr-8 cursor-pointer',
                      infPlatform && 'border-violet-400 text-violet-700')}
                  >
                    <option value="">Todas las plataformas</option>
                    {infPlatformOptions.map(p => (
                      <option key={p} value={p}>{PLATFORM_ICONS[p] ?? ''} {p.charAt(0).toUpperCase() + p.slice(1)}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
                </div>
              )}

              <div className="relative">
                <select
                  value={infStatus}
                  onChange={e => setInfStatus(e.target.value)}
                  className={cn('input-base appearance-none pr-8 cursor-pointer',
                    infStatus && 'border-violet-400 text-violet-700')}
                >
                  <option value="">Todos los estados</option>
                  <option value="draft">Por confirmar</option>
                  <option value="pending_approval">En revisión</option>
                  <option value="active">Activo</option>
                  <option value="paused">Pausado</option>
                  <option value="completed">Completado</option>
                  <option value="canceled">Cancelado</option>
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
              </div>

              <ColumnVisibilityMenu
                columns={CI_COLUMNS}
                visible={ciVisibleColumns}
                onToggle={toggleCiColumn}
                onReset={() => setCiVisibleColumns(DEFAULT_CI_COLUMNS)}
              />

              {infFiltersActive && (
                <button
                  onClick={() => { setInfSearch(''); setInfPlatform(''); setInfStatus('') }}
                  className="flex items-center gap-1.5 text-xs font-medium text-violet-600 hover:text-violet-700 px-3 py-2 rounded-lg hover:bg-violet-50 transition-colors"
                >
                  <X className="h-3.5 w-3.5" /> Limpiar
                </button>
              )}
            </div>
          )}

          {confirmedInfluencers.length === 0 ? (
            isBrandPortal ? null : (
              <div className="card p-12 text-center">
                <Users className="h-10 w-10 text-gray-200 mx-auto mb-3" />
                <p className="text-sm text-gray-400">Sin influencers asignados aún</p>
                <Link
                  href={`/admin-campaigns/${id}/influencers/add`}
                  className="mt-3 inline-block text-sm text-violet-600 hover:underline font-medium"
                >
                  + Agregar el primero
                </Link>
              </div>
            )
          ) : filteredInfluencers.length === 0 ? (
            <div className="card p-12 text-center">
              <Search className="h-10 w-10 text-gray-200 mx-auto mb-3" />
              <p className="text-sm text-gray-400">No se encontraron influencers con esos filtros.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-4 items-start">
              <div className="card overflow-x-auto">
              <table className="w-full min-w-[640px]">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="px-3 py-3 text-left bg-gray-50 w-8">
                      {remindablePendingIds.length > 0 && (
                        <input
                          type="checkbox"
                          title="Seleccionar todas las que tienen pendientes"
                          className="w-3.5 h-3.5 accent-violet-600 cursor-pointer"
                          checked={remindablePendingIds.every(pid => remindSelection.has(pid))}
                          onChange={(e) => {
                            setRemindSelection(prev => {
                              const next = new Set(prev)
                              if (e.target.checked) remindablePendingIds.forEach(pid => next.add(pid))
                              else remindablePendingIds.forEach(pid => next.delete(pid))
                              return next
                            })
                          }}
                        />
                      )}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider bg-gray-50">Influencer</th>
                    {ciVisibleColumns.platform && (
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider bg-gray-50">Plataforma</th>
                    )}
                    {ciVisibleColumns.fee && (
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider bg-gray-50">Fee</th>
                    )}
                    {ciVisibleColumns.deliverables && (
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider bg-gray-50">Deliverables</th>
                    )}
                    {ciVisibleColumns.progress && (
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider bg-gray-50">Progreso</th>
                    )}
                    {ciVisibleColumns.status && (
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider bg-gray-50">Estado</th>
                    )}
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider bg-gray-50"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredInfluencers.map((ci, i) => {
                    const inf = ci.influencer
                    if (!inf) return null
                    const primarySP = inf.influencer_social_profiles?.[0]
                    const myDelivs    = campaignDeliverables.filter(d => d.influencer?.id === inf.id)
                    const delivsDone  = myDelivs.filter(d => d.status === 'published').length
                    const delivsTotal = myDelivs.length
                    const myPending   = myDelivs.filter(d => !isDeliverableComplete(d)).length
                    const p = delivsTotal > 0
                      ? Math.round(myDelivs.reduce((sum, d) => {
                          if (d.status === 'published') return sum + 100
                          return sum + (d.progress ?? 0)
                        }, 0) / delivsTotal)
                      : 0
                    const gradient = GRADIENTS[i % GRADIENTS.length]
                    const initials = inf.display_name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()

                    return (
                      <tr
                        key={ci.id}
                        onClick={() => setSelectedInfluencerId(inf.id)}
                        className={cn(
                          'hover:bg-gray-50/70 transition-colors cursor-pointer',
                          selectedInfluencer?.id === inf.id ? 'bg-violet-50/70' : ''
                        )}
                      >
                        <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                          {myPending > 0 && (
                            <input
                              type="checkbox"
                              className="w-3.5 h-3.5 accent-violet-600 cursor-pointer"
                              checked={remindSelection.has(inf.id)}
                              onChange={(e) => {
                                setRemindSelection(prev => {
                                  const next = new Set(prev)
                                  if (e.target.checked) next.add(inf.id)
                                  else next.delete(inf.id)
                                  return next
                                })
                              }}
                            />
                          )}
                        </td>
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
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setSelectedInfluencerId(inf.id)
                                }}
                                className="text-left text-sm font-semibold text-gray-900 hover:text-violet-700 transition-colors"
                              >
                                {inf.display_name}
                              </button>
                              {primarySP?.username && <div className="text-xs text-gray-400">@{primarySP.username}</div>}
                            </div>
                          </div>
                        </td>
                        {ciVisibleColumns.platform && (
                          <td className="px-4 py-3 text-sm text-gray-500">
                            {primarySP ? (
                              <span className="flex items-center gap-1.5">
                                {PLATFORM_ICONS[primarySP.platform]}
                                <span className="font-medium">{((primarySP.followers ?? 0) / 1000).toFixed(0)}K</span>
                              </span>
                            ) : '—'}
                          </td>
                        )}
                        {ciVisibleColumns.fee && (
                          <td className="px-4 py-3">
                            <span className="text-sm font-bold text-gray-900">{ci.fee ? formatCurrency(ci.fee, 'CLP') : '—'}</span>
                          </td>
                        )}
                        {ciVisibleColumns.deliverables && (
                          <td className="px-4 py-3 text-sm text-gray-500">
                            <span className={cn('font-semibold', delivsDone === delivsTotal && delivsTotal > 0 ? 'text-emerald-600' : 'text-gray-900')}>
                              {delivsDone}
                            </span>/{delivsTotal}
                          </td>
                        )}
                        {ciVisibleColumns.progress && (
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
                        )}
                        {ciVisibleColumns.status && (
                        <td className="px-4 py-3">
                          <select
                            onClick={(e) => e.stopPropagation()}
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
                        )}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            {typeof ci.metadata?.last_reminder_sent_at === 'string' && (
                              <span
                                title={`Recordatorio enviado ${formatDatetime(ci.metadata.last_reminder_sent_at)}`}
                                className="flex items-center gap-1 text-emerald-600 flex-shrink-0"
                              >
                                <Check className="h-3.5 w-3.5" />
                                <span className="text-[10px] whitespace-nowrap hidden xl:inline">
                                  {formatDate(ci.metadata.last_reminder_sent_at)}
                                </span>
                              </span>
                            )}
                            {myPending > 0 && (
                              <RemindButton campaignId={id} influencerId={inf.id} compact onSent={() => void refetch()} />
                            )}
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

              <div className="card p-4 xl:sticky xl:top-4">
                {selectedInfluencer && selectedInfluencerCI ? (
                  <div className="space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        {selectedInfluencer.avatar_url ? (
                          <img src={selectedInfluencer.avatar_url} alt={selectedInfluencer.display_name} className="w-14 h-14 rounded-2xl object-cover flex-shrink-0" />
                        ) : (
                          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center text-white text-lg font-bold flex-shrink-0">
                            {selectedInfluencer.display_name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0">
                          <h3 className="text-base font-bold text-gray-900 truncate">{selectedInfluencer.display_name}</h3>
                          <p className="text-xs text-gray-400">
                            {[selectedInfluencer.city, selectedInfluencer.country].filter(Boolean).join(', ') || 'Sin ubicación'}
                          </p>
                        </div>
                      </div>
                      <Link
                        href={`/admin-influencers/${selectedInfluencer.id}?from=${encodeURIComponent(`/admin-campaigns/${id}?tab=influencers`)}`}
                        className="text-xs font-semibold text-violet-600 hover:underline flex-shrink-0"
                      >
                        Ver perfil completo
                      </Link>
                    </div>

                    {selectedInfluencer.influencer_social_profiles?.length ? (
                      <div className="space-y-2">
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Redes</p>
                        {selectedInfluencer.influencer_social_profiles.slice(0, 3).map(sp => {
                          const profileUrl = buildProfileUrl(sp.platform, sp.username)
                          return (
                            <div key={`${sp.platform}-${sp.username ?? 'sin-usuario'}`} className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2">
                              <div className="text-sm text-gray-700">
                                {PLATFORM_ICONS[sp.platform]} <span className="font-semibold capitalize">{sp.platform}</span>
                                {sp.username ? (
                                  profileUrl ? (
                                    <a href={profileUrl} target="_blank" rel="noopener noreferrer" className="text-violet-600 hover:underline"> @{sp.username}</a>
                                  ) : (
                                    <span className="text-gray-400"> @{sp.username}</span>
                                  )
                                ) : null}
                              </div>
                              <div className="text-xs font-bold text-gray-900">
                                {((sp.followers ?? 0) / 1000).toFixed(0)}K
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ) : null}

                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-xl bg-gray-50 p-3">
                        <p className="text-[10px] font-bold text-gray-400 uppercase">Fee</p>
                        <p className="text-sm font-bold text-gray-900">{selectedInfluencerCI.fee ? formatCurrency(selectedInfluencerCI.fee, 'CLP') : '—'}</p>
                      </div>
                      <div className="rounded-xl bg-gray-50 p-3">
                        <p className="text-[10px] font-bold text-gray-400 uppercase">Estado</p>
                        <p className="text-sm font-bold text-gray-900">{selectedInfluencerCI.status ?? 'draft'}</p>
                      </div>
                    </div>

                    {selectedInfluencerCI.notes && (
                      <div className="rounded-xl bg-violet-50 border border-violet-100 p-3">
                        <p className="text-[10px] font-bold text-violet-500 uppercase mb-1">Notas</p>
                        <p className="text-sm text-gray-700 whitespace-pre-line">{selectedInfluencerCI.notes}</p>
                      </div>
                    )}

                    <div className="space-y-2">
                      <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                        Deliverables de esta campaña ({selectedInfluencerDeliverables.length})
                      </p>
                      {selectedInfluencerDeliverables.length === 0 ? (
                        <p className="text-sm text-gray-400 rounded-xl bg-gray-50 p-3">Sin deliverables asignados.</p>
                      ) : (
                        <div className="space-y-2 max-h-[360px] overflow-auto pr-1">
                          {selectedInfluencerDeliverables.map(d => {
                            const cfg = DEL_CONFIG[d.status] ?? DEL_CONFIG.pending
                            return (
                              <div key={d.id} className="rounded-xl border border-gray-100 p-3">
                                <div className="flex items-start justify-between gap-2">
                                  <div>
                                    <p className="text-sm font-semibold text-gray-900">{d.title}</p>
                                    <p className="text-xs text-gray-400">
                                      {d.platform ? `${d.platform} · ` : ''}{d.due_date ? `Entrega ${formatDate(d.due_date)}` : 'Sin fecha'}
                                    </p>
                                  </div>
                                  <span className={cn('badge text-[10px]', cfg.cls)}>{cfg.label}</span>
                                </div>
                                {(d.published_url || d.content_url) && (
                                  <a
                                    href={d.published_url || d.content_url || '#'}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-violet-600 hover:underline"
                                  >
                                    <ExternalLink className="h-3 w-3" /> Ver contenido
                                  </a>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-10">
                    <Users className="h-8 w-8 text-gray-200 mx-auto mb-2" />
                    <p className="text-sm text-gray-400">Selecciona una influencer para ver detalles.</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── DELIVERABLES ─────────────────────────────────────────────────────── */}
      {tab === 'deliverables' && (
        <div className="space-y-3">
          {/* Solo se listan deliverables donde el influencer ya subió su URL
              (content_url o published_url) — evita ruido de los templates
              creados en bulk para todas las invitadas que aún no entregan nada. */}
          {(() => {
            const submittedDeliverables = campaignDeliverables.filter(d => d.content_url || d.published_url)

            return (
              <>
                {/* Header with status pills + Add button */}
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    {(Object.entries(DEL_CONFIG) as [DeliverableStatus, typeof DEL_CONFIG[DeliverableStatus]][]).map(([st, cfg]) => {
                      const count = submittedDeliverables.filter(d => d.status === st).length
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

                {submittedDeliverables.length === 0 && !addingDeliverable ? (
                  <div className="card p-12 text-center">
                    <FileText className="h-10 w-10 text-gray-200 mx-auto mb-3" />
                    <p className="text-sm text-gray-400">
                      {campaignDeliverables.length === 0
                        ? 'Sin deliverables asignados aún'
                        : 'Ninguna influencer ha subido su URL todavía'}
                    </p>
                    {campaignDeliverables.length === 0 && (
                      <button onClick={() => setAddingDeliverable(true)}
                        className="mt-3 text-xs text-violet-600 hover:underline">
                        + Agregar el primero
                      </button>
                    )}
                  </div>
                ) : (
                  (() => {
                    // Instagram + seguidores por influencer — reusa influencer_social_profiles
                    // ya cargado en campaign_influencers (mismo dato que se muestra en
                    // el tab Influencers), sin queries nuevas.
                    const igByInfluencerId = new Map<string, string | null>()
                    const followersByInfluencerId = new Map<string, number | null>()
                    for (const ci of campaignInfluencers) {
                      const igProfile = ci.influencer?.influencer_social_profiles?.find(sp => sp.platform === 'instagram')
                      if (ci.influencer?.id) {
                        igByInfluencerId.set(ci.influencer.id, igProfile?.username ?? null)
                        followersByInfluencerId.set(ci.influencer.id, igProfile?.followers ?? null)
                      }
                    }

                    const groups = new Map<string, { influencer: { id: string; display_name: string; avatar_url: string | null }; items: CampaignDeliverableDetail[] }>()
                    for (const d of submittedDeliverables) {
                      if (!d.influencer) continue
                      const key = d.influencer.id
                      if (!groups.has(key)) groups.set(key, { influencer: d.influencer, items: [] })
                      groups.get(key)!.items.push(d)
                    }

                    // % completado y rating promedio POR influencer en ESTA
                    // campaña (no el global de arriba) — base: TODOS sus
                    // deliverables de la campaña, no solo los ya subidos.
                    const statsByInfluencerId = new Map<string, {
                      pct: number; avgRating: number | null; ratedCount: number
                      views: number; likes: number; comments: number; avgEngagement: number | null; hasMetrics: boolean
                    }>()
                    for (const d of campaignDeliverables) {
                      if (!d.influencer) continue
                      const key = d.influencer.id
                      if (!statsByInfluencerId.has(key)) statsByInfluencerId.set(key, {
                        pct: 0, avgRating: null, ratedCount: 0,
                        views: 0, likes: 0, comments: 0, avgEngagement: null, hasMetrics: false,
                      })
                    }
                    for (const key of Array.from(statsByInfluencerId.keys())) {
                      const own = campaignDeliverables.filter(d => d.influencer?.id === key)
                      const ownDone = own.filter(isDeliverableComplete).length
                      const ownRated = own.filter(d => d.content_rating != null)
                      const pct = own.length > 0 ? Math.round((ownDone / own.length) * 100) : 0
                      const avgRating = ownRated.length > 0
                        ? Math.round((ownRated.reduce((s, d) => s + (d.content_rating as number), 0) / ownRated.length) * 10) / 10
                        : null
                      // Métricas reales (Apify) por influencer — solo suma
                      // deliverables ya sincronizados. Sin reach/impressions/
                      // saves/shares (no existen). Engagement = promedio calculado.
                      const ownWithMetrics = own.filter(d => d.performance != null)
                      const views = ownWithMetrics.reduce((s, d) => s + (d.performance?.views ?? 0), 0)
                      const likes = ownWithMetrics.reduce((s, d) => s + (d.performance?.likes ?? 0), 0)
                      const comments = ownWithMetrics.reduce((s, d) => s + (d.performance?.comments ?? 0), 0)
                      const ownRates = ownWithMetrics.map(d => d.engagement_rate).filter((v): v is number => v != null)
                      const avgEngagement = ownRates.length > 0
                        ? Math.round((ownRates.reduce((s, v) => s + v, 0) / ownRates.length) * 100) / 100
                        : null
                      statsByInfluencerId.set(key, {
                        pct, avgRating, ratedCount: ownRated.length,
                        views, likes, comments, avgEngagement, hasMetrics: ownWithMetrics.length > 0,
                      })
                    }

                    return Array.from(groups.values()).map(g => {
                      const stats = statsByInfluencerId.get(g.influencer.id)
                      return (
                        <DeliverableInfluencerGroup
                          key={g.influencer.id}
                          influencer={g.influencer}
                          igUsername={igByInfluencerId.get(g.influencer.id) ?? null}
                          followers={followersByInfluencerId.get(g.influencer.id) ?? null}
                          items={g.items}
                          campaignId={id}
                          reviewNotes={reviewNotes}
                          setReviewNotes={setReviewNotes}
                          pct={stats?.pct ?? 0}
                          avgRating={stats?.avgRating ?? null}
                          ratedCount={stats?.ratedCount ?? 0}
                          metrics={stats?.hasMetrics ? { views: stats.views, likes: stats.likes, comments: stats.comments, avgEngagement: stats.avgEngagement } : null}
                        />
                      )
                    })
                  })()
                )}
              </>
            )
          })()}
        </div>
      )}

      {/* ── HISTORIAL ────────────────────────────────────────────────────────── */}

      {/* ── MARCAS ─────────────────────────────────────────────────────────── */}
      {false && (
        <div className="card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">Marcas de la campaña</h3>
            <Link href={`/admin-campaigns/${id}/edit`} className="text-sm font-semibold text-violet-600 hover:underline">
              Editar campaña
            </Link>
          </div>

          {campaignBrands.length === 0 ? (
            <p className="text-sm text-gray-400">Sin marcas asociadas.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {campaignBrands.map((brand, idx) => (
                <div key={`${brand.id ?? idx}`} className="rounded-xl border border-gray-100 p-4">
                  <p className="text-sm font-semibold text-gray-900">{String(brand.name ?? 'Marca sin nombre')}</p>
                  <p className="text-xs text-gray-500 mt-1">{String(brand._role ?? '')}</p>
                  {brand.contact_email ? <p className="text-xs text-gray-500 mt-2">{String(brand.contact_email)}</p> : null}
                  {brand.website ? (
                    <a href={String(brand.website)} target="_blank" rel="noopener noreferrer" className="text-xs text-violet-600 hover:underline mt-2 inline-flex items-center gap-1">
                      Website <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── LUGARES ────────────────────────────────────────────────────────── */}
      {tab === 'locations' && (
        <div className="card p-6 space-y-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-700">Lugares asociados a la marca principal</h3>
              <p className="text-xs text-gray-400 mt-1">
                Estos lugares quedan guardados en la marca principal de esta campaña.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setLocationFormOpen(prev => !prev)}
              className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-semibold hover:bg-violet-700 shrink-0"
            >
              {locationFormOpen ? 'Cerrar' : '+ Agregar lugar'}
            </button>
          </div>

          {locationFormOpen && (
            <form onSubmit={handleAddBrandLocation} className="rounded-xl border border-gray-100 bg-gray-50 p-4 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input
                  value={locationForm.name}
                  onChange={e => setLocationForm(prev => ({ ...prev, name: e.target.value }))}
                  className="input-base w-full text-sm bg-white"
                  placeholder="Nombre del lugar"
                />
                <input
                  value={locationForm.address}
                  onChange={e => setLocationForm(prev => ({ ...prev, address: e.target.value }))}
                  className="input-base w-full text-sm bg-white"
                  placeholder="Dirección"
                />
                <input
                  value={locationForm.city}
                  onChange={e => setLocationForm(prev => ({ ...prev, city: e.target.value }))}
                  className="input-base w-full text-sm bg-white"
                  placeholder="Ciudad / comuna"
                />
                <input
                  value={locationForm.region}
                  onChange={e => setLocationForm(prev => ({ ...prev, region: e.target.value }))}
                  className="input-base w-full text-sm bg-white"
                  placeholder="Región"
                />
                <input
                  value={locationForm.country}
                  onChange={e => setLocationForm(prev => ({ ...prev, country: e.target.value }))}
                  className="input-base w-full text-sm bg-white"
                  placeholder="País"
                />
                <label className="flex items-center gap-2 text-sm text-gray-600">
                  <input
                    type="checkbox"
                    checked={locationForm.is_public}
                    onChange={e => setLocationForm(prev => ({ ...prev, is_public: e.target.checked }))}
                  />
                  Visible para marca/influencer
                </label>
              </div>

              <textarea
                value={locationForm.notes}
                onChange={e => setLocationForm(prev => ({ ...prev, notes: e.target.value }))}
                className="input-base w-full text-sm bg-white"
                placeholder="Notas internas"
                rows={3}
              />

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={locationSaving}
                  className="px-4 py-2 rounded-lg bg-violet-600 text-white text-xs font-semibold hover:bg-violet-700 disabled:opacity-60"
                >
                  {locationSaving ? 'Guardando...' : 'Guardar lugar'}
                </button>
              </div>
            </form>
          )}

          {brandLocations.length === 0 ? (
            <p className="text-sm text-gray-400">Sin lugares asociados todavía.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {brandLocations.map((loc, idx) => (
                <div key={`${loc.id ?? idx}`} className="rounded-xl border border-gray-100 p-4 bg-white">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{String(loc.name ?? loc.label ?? 'Lugar sin nombre')}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        {[loc.address, loc.city, loc.region, loc.country].filter(Boolean).map(String).join(', ') || 'Sin dirección visible'}
                      </p>
                    </div>
                    {loc.is_public ? (
                      <span className="text-[10px] px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 font-semibold">Público</span>
                    ) : (
                      <span className="text-[10px] px-2 py-1 rounded-full bg-gray-100 text-gray-500 font-semibold">Privado</span>
                    )}
                  </div>
                  {loc.notes ? <p className="text-xs text-gray-400 mt-3">{String(loc.notes)}</p> : null}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── ASSETS ─────────────────────────────────────────────────────────── */}
      {tab === 'assets' && (
        <div className="card p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">Assets de esta campaña</h3>
            <span className="text-xs text-gray-400">{campaignAssets.length} asset(s)</span>
          </div>

          <form onSubmit={handleAddCampaignAsset} className="grid grid-cols-1 md:grid-cols-[1fr_1.5fr_auto] gap-3 items-end">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Nombre</label>
              <input
                value={assetName}
                onChange={e => setAssetName(e.target.value)}
                className="input-base w-full text-sm"
                placeholder="Ej: Logo, brief, foto producto"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">URL del asset</label>
              <input
                value={assetUrl}
                onChange={e => setAssetUrl(e.target.value)}
                className="input-base w-full text-sm"
                placeholder="https://..."
              />
            </div>
            <button
              type="submit"
              disabled={assetSaving}
              className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-60"
            >
              {assetSaving ? 'Guardando...' : 'Agregar'}
            </button>
          </form>

          {campaignAssets.length === 0 ? (
            <p className="text-sm text-gray-400">Sin assets cargados para esta campaña.</p>
          ) : (
            <div className="space-y-3">
              {campaignAssets.map(asset => (
                <div key={String(asset.id)} className="flex items-center justify-between rounded-xl border border-gray-100 p-4 gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{String(asset.filename ?? 'Asset')}</p>
                    <p className="text-xs text-gray-400 truncate">{String(asset.storage_path ?? '')}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <a
                      href={String(asset.signed_url ?? asset.storage_path)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-semibold text-violet-600 hover:underline inline-flex items-center gap-1"
                    >
                      Abrir <ExternalLink className="h-3 w-3" />
                    </a>
                    <button
                      onClick={() => handleDeleteCampaignAsset(String(asset.id))}
                      className="text-xs font-semibold text-red-500 hover:underline"
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── BILLING ────────────────────────────────────────────────────────── */}
      {tab === 'billing' && (
        <div className="card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">Facturas de esta campaña</h3>
            <Link href={`/admin-billing?campaign_id=${id}`} className="text-sm font-semibold text-violet-600 hover:underline">
              Ver en billing
            </Link>
          </div>

          {campaignInvoices.length === 0 ? (
            <p className="text-sm text-gray-400">Sin facturas asociadas a esta campaña.</p>
          ) : (
            <div className="space-y-3">
              {campaignInvoices.map(inv => (
                <div key={String(inv.id)} className="rounded-xl border border-gray-100 p-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{String(inv.invoice_number ?? 'Factura')}</p>
                    <p className="text-xs text-gray-500">{String(inv.status ?? 'draft')}</p>
                  </div>
                  <p className="text-sm font-bold text-gray-900">{formatCurrency(Number(inv.total ?? 0), String(inv.currency ?? 'CLP'))}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── CONTRATOS ──────────────────────────────────────────────────────── */}
      {false && (
        <div className="card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">Plantillas de contrato</h3>
            <Link href="/admin-contracts" className="text-sm font-semibold text-violet-600 hover:underline">
              Administrar contratos
            </Link>
          </div>

          {contractTemplates.length === 0 ? (
            <p className="text-sm text-gray-400">Sin plantillas de contrato todavía.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {contractTemplates.map(tpl => (
                <div key={String(tpl.id)} className="rounded-xl border border-gray-100 p-4">
                  <p className="text-sm font-semibold text-gray-900">{String(tpl.name ?? 'Plantilla')}</p>
                  <p className="text-xs text-gray-500 mt-1">{String(tpl.campaign_type ?? 'General')}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── CANJES ─────────────────────────────────────────────────────────── */}
      {false && (
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
