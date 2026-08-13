'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowLeft, Target, Calendar, DollarSign, Users, FileText,
  BarChart3, ExternalLink, CheckCircle2,
  XCircle, Clock, Pencil, Play, Pause, Check, AlertCircle, Loader2, Trash2, Plus, FileDown, Gift,
  ChevronRight, Search, X, ChevronDown, Star, Mail, Eye, Heart, MessageCircle, RefreshCw, MapPin, Upload, Download, ImagePlus, Copy,
} from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { cn, formatCurrency, formatDate, formatDatetime, formatFollowers, PLATFORM_ICONS } from '@/lib/utils'
import { CampaignStatusBadge, campaignStatusLabel, campaignStatusBadgeClass, CAMPAIGN_STATUS_OPTIONS } from '@/components/campaigns/CampaignStatusBadge'
import { BartersTab } from '@/components/campaigns/BartersTab'
import { StarRating } from '@/components/ui/StarRating'
import { ColumnVisibilityMenu } from '@/components/ui/ColumnVisibilityMenu'
import { useLocalStorageState } from '@/hooks/useLocalStorageState'
import type { CampaignDetail, CampaignDeliverableDetail, DeliverableStatus, CampaignStatus, InfluencerTier } from '@/types'
import { getInfluencerTier } from '@/types'
import { useCampaignDetail, usePatchCampaign, useDeliverableAction, useRemoveCampaignInfluencer, useSyncDeliverableMetrics } from '@/hooks/useCampaignsList'
import { isDeliverableComplete } from '@/lib/deliverable-status'
import { COMUNAS_CHILE, groupCommunes } from '@/lib/communes-chile'
import { toast } from 'sonner'
import { NewInvoiceModal } from '@/app/(dashboard)/admin-billing/BillingClient'
import { DeliverableTemplateBuilder, CAMPAIGN_DELIVERABLE_DEFAULTS, type DeliverableTemplate } from '@/components/campaigns/DeliverableTemplateBuilder'
import { BrandSelector } from '@/components/campaigns/BrandSelector'
import { AttendanceConfirmationPanel } from '@/components/campaigns/AttendanceConfirmationPanel'
import { createClient } from '@/lib/supabase/client'

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

type Tab = 'overview' | 'influencers' | 'deliverables' | 'barters' | 'assets' | 'locations' | 'billing' | 'history'
const VALID_TABS: Tab[] = ['overview', 'influencers', 'deliverables', 'barters', 'assets', 'locations', 'billing', 'history']

// ── Columnas toggleables de la tabla del tab Influencers (mismo patrón que
// admin-brands/page.tsx: Influencer y Acciones quedan siempre fijas). ────────
type CiColumnKey = 'platform' | 'categories' | 'followers' | 'engagement' | 'rating' | 'commune' | 'fee' | 'deliverables' | 'progress' | 'status'
const CI_COLUMNS: Array<{ key: CiColumnKey; label: string }> = [
  { key: 'platform',     label: 'Plataforma' },
  { key: 'categories',   label: 'Categorías' },
  { key: 'followers',    label: 'Seguidores' },
  { key: 'engagement',   label: 'Engagement' },
  { key: 'rating',       label: 'Rating' },
  { key: 'commune',      label: 'Comuna' },
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
  const supportsPerformanceMetrics = d.type === 'reel' || d.type === 'post'

  if (d.type === 'event_attendance') {
    const confirmed = d.attendance_response === 'confirmed'
    const declined = d.attendance_response === 'declined'
    const noShow = d.attendance_outcome === 'no_show'
    const markNoShow = async () => {
      try {
        await action.mutateAsync({ deliverable_id: d.id, action: 'mark_no_show' })
        toast.success('Marcada como no asistió. Sus métricas ya no cuentan en el resultado.')
      } catch { /* handled in hook */ }
    }
    return <div className="flex items-center justify-between gap-3 py-1"><div><p className="text-sm font-semibold text-gray-800">Confirmación de asistencia</p><p className="text-xs text-gray-400">{d.due_date ? `Plazo: ${formatDate(d.due_date)}` : 'Sin fecha límite'}</p></div><div className="flex items-center gap-2"><span className={cn('badge text-[11px]', noShow ? 'badge-red' : confirmed ? 'badge-green' : declined ? 'badge-red' : 'badge-gray')}>{noShow ? 'No asistió' : confirmed ? 'Confirmada' : declined ? 'No asistirá' : 'Pendiente'}</span>{confirmed && !noShow && <button type="button" onClick={() => void markNoShow()} disabled={action.isPending} title="Marcar que confirmó pero no asistió; se excluirá de los KPI" className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"><ChevronDown className="h-3.5 w-3.5" /> No asistió</button>}</div></div>
  }

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
      {supportsPerformanceMetrics ? <div className="mt-1.5 flex items-center gap-3 flex-wrap">
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
      </div> : <p className="mt-1.5 text-[11px] text-gray-400">Story: entregable de cumplimiento; no se mide en el reporte.</p>}
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
  influencer, igUsername, followers, items, campaignId, reviewNotes, setReviewNotes, pct, avgRating, ratedCount, metrics, attendanceReminder,
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
  attendanceReminder?: { selected: boolean; sending: boolean; onSelected: (selected: boolean) => void; onSend: () => void }
}) {
  const [open, setOpen] = useState(false)
  const noShow = items.some(item => item.type === 'event_attendance' && item.attendance_outcome === 'no_show')

  // Estado por deliverable del grupo — para que el header diga "en revisión"
  // / "aprobado" en vez de solo el conteo, y se sepa sin abrir cuál necesita
  // acción. Reusa DEL_CONFIG (mismo label/color que ya se usa por deliverable).
  const statusCounts = items.reduce<Partial<Record<DeliverableStatus, number>>>((acc, d) => {
    acc[d.status] = (acc[d.status] ?? 0) + 1
    return acc
  }, {})
  const STATUS_ORDER: DeliverableStatus[] = ['in_review', 'rejected', 'pending', 'approved', 'published']
  const statusBadges = noShow ? (
    <span className="badge bg-gray-200 text-gray-600 text-[11px]">No asistió</span>
  ) : (
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
    <div className={cn('card p-2 space-y-1.5', noShow && 'bg-gray-100 opacity-70 grayscale')}>
      <div className="flex items-center justify-between gap-3 cursor-pointer" onClick={() => setOpen(v => !v)}>
        <div className="flex items-center gap-3 flex-wrap">
          <InfluencerBadge influencer={influencer} igUsername={igUsername} />
          <FollowersStat followers={followers} />
          <ContentMetricsStats metrics={metrics} />
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {scoreBlocks}
          {statusBadges}
          {attendanceReminder && <div className="flex items-center gap-1" onClick={event => event.stopPropagation()}>
            <input aria-label={`Seleccionar a ${influencer.display_name} para recordatorio`} type="checkbox" checked={attendanceReminder.selected} onChange={event => attendanceReminder.onSelected(event.target.checked)} className="h-4 w-4 rounded border-gray-300 text-violet-600 focus:ring-violet-500" />
            <button type="button" disabled={attendanceReminder.sending} onClick={attendanceReminder.onSend} title="Enviar recordatorio de asistencia por email" className="rounded-lg p-1.5 text-violet-600 hover:bg-violet-50 disabled:opacity-50">{attendanceReminder.sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}</button>
          </div>}
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
  campaignId, influencers, collaboratorBrands, onSuccess, onCancel,
}: {
  campaignId: string
  influencers: Array<{ id: string; name: string }>
  collaboratorBrands: Array<{ id: string; name: string; instagram?: string | null }>
  onSuccess: () => void
  onCancel: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [brandIds, setBrandIds] = useState<string[]>([])
  const [form, setForm] = useState({
    influencer_id: influencers[0]?.id ?? '',
    type: 'reel',
    title: '',
    description: '',
    due_date: '',
    scheduled_at: '',
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
          scheduled_at:  form.scheduled_at ? new Date(form.scheduled_at).toISOString() : null,
          quantity:      form.quantity,
          brand_ids:     brandIds,
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
          <label className="text-xs text-gray-500 mb-1 block">Publicar el día y hora</label>
          <input type="datetime-local" value={form.scheduled_at} onChange={e => f('scheduled_at', e.target.value)}
            className="input-base w-full text-sm py-1.5" />
        </div>
        <div className="col-span-2">
          <label className="text-xs text-gray-500 mb-1 block">Descripción / instrucciones</label>
          <textarea value={form.description} maxLength={3000} rows={3} onChange={e => f('description', e.target.value)}
            placeholder="Instrucciones para el influencer"
            className="input-base w-full text-sm py-1.5 resize-y" />
          <p className="text-[11px] text-gray-400 text-right mt-1">{form.description.length} / 3000</p>
        </div>
        {collaboratorBrands.length > 0 && <div className="col-span-2 rounded-lg border border-fuchsia-100 bg-fuchsia-50/40 p-3">
          <p className="text-xs font-semibold text-fuchsia-800">Marcas a etiquetar en este entregable</p>
          <p className="mt-0.5 text-[11px] text-fuchsia-700">Solo estas marcas se mostrarán a la influencer para este contenido.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {collaboratorBrands.map(brand => <label key={brand.id} className="flex cursor-pointer items-center gap-1.5 rounded-md bg-white px-2 py-1 text-xs font-medium text-gray-700 ring-1 ring-fuchsia-100">
              <input type="checkbox" checked={brandIds.includes(brand.id)} onChange={event => setBrandIds(current => event.target.checked ? [...current, brand.id] : current.filter(id => id !== brand.id))} />
              {brand.instagram ? `@${brand.instagram.replace(/^@/, '')}` : brand.name}
            </label>)}
          </div>
        </div>}
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
function CampaignBrandsPanel({
  campaignId,
  brands,
  canManage,
  canChangePrimary,
  onChanged,
}: {
  campaignId: string
  brands: Array<{ id?: string; name?: string; logo_url?: string | null; instagram?: string | null; _role?: string }>
  canManage: boolean
  canChangePrimary: boolean
  onChanged: () => void
}) {
  if (brands.length === 0 && !canManage) return null

  return (
    <div className="card px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-gray-700">Marcas participantes</h3>
        <span className="text-xs text-gray-400">{brands.length} {brands.length === 1 ? 'marca' : 'marcas'}</span>
      </div>
      {brands.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {brands.map((brand, idx) => (
            <div key={`${brand.id ?? idx}`} className="group flex min-w-0 items-center gap-1.5 rounded-lg border border-gray-100 bg-gray-50 px-2 py-1.5">
              <div className="flex min-w-0 items-center gap-1.5">
                {brand.logo_url ? (
                  <img src={brand.logo_url} alt={brand.name ?? 'Marca'} className="h-5 w-5 flex-shrink-0 rounded object-contain" />
                ) : (
                  <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded bg-violet-50 text-[10px] font-bold text-violet-600">{(brand.name ?? '?').slice(0, 1).toUpperCase()}</span>
                )}
                {brand.instagram ? (
                  <a href={`https://instagram.com/${brand.instagram.replace(/^@/, '')}`} target="_blank" rel="noopener noreferrer" className="max-w-[170px] truncate text-xs font-semibold text-violet-700 hover:underline">@{brand.instagram.replace(/^@/, '')}</a>
                ) : (
                  <span className="max-w-[150px] truncate text-xs font-semibold text-gray-800">{brand.name ?? 'Marca sin nombre'}</span>
                )}
                {brand._role === 'Principal' && <span className="rounded-full bg-violet-50 px-1.5 py-0.5 text-[9px] font-medium text-violet-700">Principal</span>}
              </div>
              {canManage && brand._role === 'Colaboradora' && brand.id && (
                <button type="button" aria-label={`Quitar ${brand.name ?? 'marca'}`} className="ml-1 text-gray-300 hover:text-red-500" onClick={async () => {
                  if (!confirm(`¿Quitar ${brand.name ?? 'esta marca'} de la campaña?`)) return
                  try {
                    const response = await fetch(`/api/campaigns/${campaignId}/brands?brand_id=${brand.id}`, { method: 'DELETE' })
                    const result = await response.json()
                    if (!response.ok) throw new Error(result.error)
                    toast.success('Marca quitada de la campaña')
                    onChanged()
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : 'No se pudo quitar la marca')
                  }
                }}><X className="h-3.5 w-3.5" /></button>
              )}
            </div>
          ))}
        </div>
      )}
      <PrimaryBrandManager campaignId={campaignId} brands={brands} canManage={canChangePrimary} onChanged={onChanged} />
      <CoBrandManager campaignId={campaignId} canManage={canManage} onChanged={onChanged} />
    </div>
  )
}

function PrimaryBrandManager({
  campaignId,
  brands,
  canManage,
  onChanged,
}: {
  campaignId: string
  brands: Array<{ id?: string; name?: string; _role?: string }>
  canManage: boolean
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const [brandId, setBrandId] = useState('')
  const [saving, setSaving] = useState(false)
  const primaryBrand = brands.find(brand => brand._role === 'Principal')

  if (!canManage) return null

  async function save() {
    if (!brandId) return
    setSaving(true)
    try {
      const response = await fetch(`/api/campaigns/${campaignId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand_id: brandId }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? 'No se pudo asignar la marca principal')
      toast.success('Marca principal actualizada')
      setOpen(false)
      setBrandId('')
      onChanged()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo asignar la marca principal')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 hover:text-violet-700">
          <Plus className="h-3.5 w-3.5" /> {primaryBrand ? 'Cambiar marca principal' : 'Asignar marca principal'}
        </button>
      ) : (
        <div className="space-y-3 rounded-xl bg-violet-50/60 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-gray-700">Marca principal de la campaña</p>
              <p className="text-[11px] text-gray-500">Es la marca que aparecerá como anfitriona para las influencers.</p>
            </div>
            <button type="button" onClick={() => { setOpen(false); setBrandId('') }} className="text-gray-400 hover:text-gray-600" aria-label="Cerrar"><X className="h-4 w-4" /></button>
          </div>
          <BrandSelector value={brandId} onChange={setBrandId} />
          <button type="button" onClick={() => void save()} disabled={!brandId || saving}
            className="w-full rounded-lg bg-violet-600 py-2 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
            {saving ? 'Guardando…' : 'Guardar marca principal'}
          </button>
        </div>
      )}
    </div>
  )
}

// Una colaboradora queda vinculada a la campaña de inmediato. Si se registra
// un email, la aprobación posterior controla únicamente el acceso a su portal;
// nunca bloquea el brief ni los tags de las influencers.
function CoBrandManager({
  campaignId,
  canManage,
  onChanged,
}: {
  campaignId: string
  canManage: boolean
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const [instagram, setInstagram] = useState('')
  const [saving, setSaving] = useState(false)

  const instagramValid = /^(?:@?[a-z0-9._]{1,30}|https?:\/\/(?:www\.)?instagram\.com\/[a-z0-9._]{1,30}\/?)/i.test(instagram.trim())

  async function submit() {
    if (!instagramValid) return
    setSaving(true)
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/brands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instagram: instagram.trim(), name: instagram.trim().replace(/^@/, '') }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Marca agregada como colaboradora')
      onChanged()
      setOpen(false)
      setInstagram('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error agregando marca')
    }
    setSaving(false)
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
        <div className="flex items-center gap-2 rounded-xl bg-gray-50 p-3">
          <input value={instagram} onChange={e => setInstagram(e.target.value)} placeholder="@instagram de la marca" className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-violet-400 bg-white" />
          <button type="button" onClick={submit} disabled={saving || !instagramValid}
            className="px-3 py-2 text-xs font-semibold bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50 flex items-center justify-center gap-2">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            {saving ? 'Guardando…' : 'Agregar'}
          </button>
          <button type="button" onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600" aria-label="Cerrar"><X className="h-4 w-4" /></button>
        </div>
      )}

    </div>
  )
}

type OverviewEditSection = 'content' | 'deliverables'

function OverviewEditPanel({ campaign, saving, isBrandPortal, section, onCancel, onSave }: {
  campaign: CampaignDetail
  saving: boolean
  isBrandPortal: boolean
  section: OverviewEditSection
  onCancel: () => void
  onSave: (values: Record<string, unknown>) => Promise<void>
}) {
  const [form, setForm] = useState({
    name: campaign.name ?? '',
    description: campaign.description ?? '',
    type: campaign.type ?? 'sponsored_post',
    visibility: campaign.visibility ?? 'private',
    start_date: campaign.start_date ?? '',
    end_date: campaign.end_date ?? '',
    application_deadline: campaign.application_deadline ?? '',
    max_influencers: campaign.max_influencers?.toString() ?? '',
    budget_total: campaign.budget_total?.toString() ?? '',
    currency: campaign.currency ?? 'CLP',
    commission_rate: campaign.commission_rate?.toString() ?? '',
    approval_required: campaign.approval_required ?? true,
    brand_id: campaign.brand_id ?? '',
    address: campaign.address ?? '',
    content_guidelines: campaign.content_guidelines ?? '',
    platforms: [...(campaign.platforms ?? [])] as string[],
    hashtags: (campaign.hashtags ?? []).join(', '),
    social_tags: (campaign.social_tags ?? []).join(', '),
    goals: { ...(campaign.goals ?? {}) } as Record<string, number>,
    deliverable_templates: (
      campaign.deliverable_templates?.length
        ? campaign.deliverable_templates
        : CAMPAIGN_DELIVERABLE_DEFAULTS[campaign.type ?? ''] ?? []
    ).map(template => ({ ...template })) as DeliverableTemplate[],
  })

  function field<K extends keyof typeof form>(key: K, value: typeof form[K]) {
    setForm(previous => ({ ...previous, [key]: value }))
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    await onSave({
      name: form.name.trim(),
      description: form.description.trim() || null,
      type: form.type,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      budget_total: form.budget_total === '' ? null : Number(form.budget_total),
      currency: form.currency,
      commission_rate: form.type === 'commission' && form.commission_rate !== '' ? Number(form.commission_rate) : null,
      approval_required: form.approval_required,
      ...(!isBrandPortal ? { brand_id: form.brand_id || null } : {}),
      address: form.address.trim() || null,
      content_guidelines: form.content_guidelines.trim() || null,
      platforms: form.platforms,
      hashtags: form.hashtags.split(',').map(item => item.trim()).filter(Boolean),
      social_tags: form.social_tags.split(',').map(item => item.trim()).filter(Boolean),
      goals: form.goals,
      deliverable_templates: form.deliverable_templates,
    })
  }

  const inputClass = 'w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100'
  const goalFields = [
    ['reach', 'Reach'], ['impressions', 'Impresiones'], ['clicks', 'Clicks'],
    ['conversions', 'Conversiones'], ['engagement_rate', 'Engagement rate (%)'],
  ] as const
  const sectionTitle: Record<OverviewEditSection, string> = {
    content: 'Editar contenido y objetivos',
    deliverables: 'Editar entregables',
  }
  const taggableBrands = [
    (campaign as unknown as { brand?: { id?: string; name?: string; instagram?: string | null } | null }).brand,
    ...(((campaign as unknown as { campaign_brands?: Array<{ brand?: { id?: string; name?: string; instagram?: string | null } | null }> }).campaign_brands ?? []).map(row => row.brand)),
  ].flatMap(brand => brand?.id ? [{ id: brand.id, name: brand.name ?? 'Marca', instagram: brand.instagram ?? null }] : [])

  return (
    <form onSubmit={submit} className="space-y-4">

      <div className="flex items-center justify-between gap-3">
        <div><h2 className="text-base font-bold text-gray-900">{sectionTitle[section]}</h2><p className="text-xs text-gray-500 mt-0.5">Solo estás editando esta sección.</p></div>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} disabled={saving} className="px-3 py-2 text-sm font-medium border border-gray-200 bg-white rounded-xl hover:bg-gray-50 disabled:opacity-50">Cancelar</button>
          <button type="submit" disabled={saving || form.name.trim().length < 3} className="px-4 py-2 text-sm font-semibold bg-violet-600 text-white rounded-xl hover:bg-violet-700 disabled:opacity-50 flex items-center gap-2">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}{saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </div>
      {section === 'content' && <div className="card p-5 space-y-4">
        <label className="text-xs font-semibold text-gray-600">Guías de contenido<textarea value={form.content_guidelines} maxLength={3000} rows={5} onChange={e => field('content_guidelines', e.target.value)} className={`${inputClass} mt-1 resize-y`} /></label>
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="text-xs font-semibold text-gray-600">Hashtags, separados por coma<input value={form.hashtags} onChange={e => field('hashtags', e.target.value)} className={`${inputClass} mt-1`} /></label>
          <label className="text-xs font-semibold text-gray-600">Tags, separados por coma<input value={form.social_tags} onChange={e => field('social_tags', e.target.value)} className={`${inputClass} mt-1`} /></label>
        </div>
        <div className="grid sm:grid-cols-3 gap-3">{goalFields.map(([key, label]) => (
          <label key={key} className="text-xs font-semibold text-gray-600">{label}<input type="number" min="0" step={key === 'engagement_rate' ? '0.1' : '1'} value={form.goals[key] ?? ''}
            onChange={e => setForm(previous => ({ ...previous, goals: { ...previous.goals, [key]: Number(e.target.value) || 0 } }))} className={`${inputClass} mt-1`} /></label>
        ))}</div>
      </div>}

      {section === 'deliverables' && <div className="card p-5"><DeliverableTemplateBuilder value={form.deliverable_templates} onChange={value => field('deliverable_templates', value)} showSuggestions={false} compact taggableBrands={taggableBrands} /></div>}

    </form>
  )
}

export function CampaignDetail({ id, defaultTab, portal = 'admin' }: { id: string; defaultTab?: Tab; portal?: 'admin' | 'brand' }) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const isBrandPortal = portal === 'brand' || pathname.startsWith('/brand')
  const apiBase = isBrandPortal ? '/api/brand/campaigns' : '/api/campaigns'
  const [tab, setTab] = useState<Tab>(defaultTab ?? 'overview')
  const [editingOverview, setEditingOverview] = useState(searchParams.get('mode') === 'edit')

  function selectTab(nextTab: Tab) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', nextTab)
    if (nextTab !== 'overview') params.delete('mode')
    setTab(nextTab)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }
  const [overviewEditSection, setOverviewEditSection] = useState<OverviewEditSection>('content')
  const [editingEvent, setEditingEvent] = useState(false)
  const [eventSaving, setEventSaving] = useState(false)
  const [eventForm, setEventForm] = useState({ name: '', starts_at: '', ends_at: '', location: '', venue_name: '', commune: '', location_instructions: '', visibility: 'private' })
  const [summaryEditOpen, setSummaryEditOpen] = useState(false)
  const [timeEditOpen, setTimeEditOpen] = useState(false)
  const [timeEditForm, setTimeEditForm] = useState({ date: '', start_time: '', end_time: '' })
  const [summaryEditSaving, setSummaryEditSaving] = useState(false)
  const [summaryEditForm, setSummaryEditForm] = useState({ name: '', start_date: '', end_date: '', visibility: 'private', venue_name: '', location: '', location_instructions: '' })
  const [eventScheduleForm, setEventScheduleForm] = useState<Array<{ id?: string; starts_at: string; ends_at: string }>>([])
  const [locationEditOpen, setLocationEditOpen] = useState(false)
  const [locationEditSaving, setLocationEditSaving] = useState(false)
  // Compatibilidad temporal: el bloque anterior no se vuelve a abrir; la
  // edición de ubicación ocurre inline con openLocationEditor.
  const [locationEditValue, setLocationEditValue] = useState('')
  const [locationEditForm, setLocationEditForm] = useState({ venueName: '', address: '', instructions: '' })
  const [deletingCampaign, setDeletingCampaign] = useState(false)
  const [duplicatingCampaign, setDuplicatingCampaign] = useState(false)
  const [selectedInfluencerId, setSelectedInfluencerId] = useState<string | null>(null)
  const [infSearch, setInfSearch] = useState('')
  const [infPlatform, setInfPlatform] = useState('')
  const [infStatus, setInfStatus] = useState('')
  const [attendanceFilter, setAttendanceFilter] = useState<'all' | 'confirmed' | 'declined' | 'no_show' | 'unconfirmed'>('all')
  const [ciVisibleColumns, setCiVisibleColumns] = useLocalStorageState<Record<CiColumnKey, boolean>>(
    'scence:campaign-detail:approved-influencers:visibleColumns', DEFAULT_CI_COLUMNS
  )
  const [pendingVisibleColumns, setPendingVisibleColumns] = useLocalStorageState<Record<CiColumnKey, boolean>>(
    'scence:campaign-detail:pending-influencers:visibleColumns', DEFAULT_CI_COLUMNS
  )
  function toggleCiColumn(key: CiColumnKey) {
    setCiVisibleColumns(prev => ({ ...prev, [key]: !prev[key] }))
  }
  function togglePendingColumn(key: CiColumnKey) {
    setPendingVisibleColumns(prev => ({ ...prev, [key]: !prev[key] }))
  }
  // Selección para enviar recordatorio a varios influencers a la vez (no
  // uno-a-uno) — reusa el mismo endpoint /remind, solo dispara N fetches.
  const [remindSelection, setRemindSelection] = useState<Set<string>>(new Set())
  const [bulkSending, setBulkSending] = useState(false)
  const [attendanceReminderSelection, setAttendanceReminderSelection] = useState<Set<string>>(new Set())
  const [attendanceReminderSending, setAttendanceReminderSending] = useState(false)

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
  const [campaignInvoices, setCampaignInvoices] = useState<Array<Record<string, unknown>>>([])
  const [showCampaignInvoiceModal, setShowCampaignInvoiceModal] = useState(false)
  const [contractTemplates, setContractTemplates] = useState<Array<Record<string, unknown>>>([])
  const [brandLocations, setBrandLocations] = useState<Array<Record<string, unknown>>>([])
  const [campaignAssets, setCampaignAssets] = useState<Array<Record<string, unknown>>>([])
  const [assetName, setAssetName] = useState('')
  const [assetUrl, setAssetUrl] = useState('')
  const [assetMode, setAssetMode] = useState<'file' | 'link'>('file')
  const [assetFile, setAssetFile] = useState<File | null>(null)
  const [assetFormOpen, setAssetFormOpen] = useState(false)
  const [assetSaving, setAssetSaving] = useState(false)
  const [briefSaving, setBriefSaving] = useState(false)
  const briefInputRef = useRef<HTMLInputElement>(null)
  const [coverSaving, setCoverSaving] = useState(false)
  const coverInputRef = useRef<HTMLInputElement>(null)
  const [locationFormOpen, setLocationFormOpen] = useState(false)
  const [locationSaving, setLocationSaving] = useState(false)
  const [locationForm, setLocationForm] = useState({
    location_type: 'store',
    name: '',
    address: '',
    city: '',
    region: '',
    country: 'Chile',
    is_public: false,
    notes: '',
  })

  // Filtros de "solicitudes pendientes" (postulaciones a campaña pública) —
  // pedido de Pri 2026-07-13: filtrar por seguidores, engagement, comuna y
  // nicho. Solo esta pantalla — reutiliza getInfluencerTier() (ya existente,
  // mismo bucketing usado en useInfluencers.ts) y el mismo criterio de
  // minEngagement que ya está implementado ahí. Client-side sobre los datos
  // que ya trae /api/campaigns/[id] — no hay endpoint ni componente nuevo.
  const [pendingTierFilter, setPendingTierFilter]       = useState<InfluencerTier | ''>('')
  const [pendingCommuneFilter, setPendingCommuneFilter] = useState('')
  const [pendingCategoryFilter, setPendingCategoryFilter] = useState('')
  const [pendingMinEngagement, setPendingMinEngagement] = useState(0)
  const [pendingMinRating, setPendingMinRating] = useState(0)
  const [pendingSearch, setPendingSearch] = useState('')
  const [pendingApplicationsOpen, setPendingApplicationsOpen] = useState(false)

  const { data: res, isLoading, error, refetch } = useCampaignDetail(id, apiBase)
  const patchCampaign = usePatchCampaign(id, apiBase)
  const removeInfluencer = useRemoveCampaignInfluencer(id)

  function setOverviewEditMode(editing: boolean, section: OverviewEditSection = 'content') {
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', 'overview')
    if (editing) {
      params.set('mode', 'edit')
      params.set('section', section)
    } else {
      params.delete('mode')
      params.delete('section')
    }
    setTab('overview')
    setOverviewEditSection(section)
    setEditingOverview(editing)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  useEffect(() => {
    const requestedTab = searchParams.get('tab')
    const requested = searchParams.get('mode') === 'edit'
    setEditingOverview(requested)
    if (requested) {
      setOverviewEditSection(searchParams.get('section') === 'deliverables' ? 'deliverables' : 'content')
      setTab('overview')
    } else if (requestedTab && VALID_TABS.includes(requestedTab as Tab)) {
      setTab(requestedTab as Tab)
    }
  }, [searchParams])

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

  async function saveOverview(values: Record<string, unknown>) {
    try {
      await patchCampaign.mutateAsync(values)
      await refetch()
      setOverviewEditMode(false)
      toast.success('Overview actualizado')
    } catch {
      // usePatchCampaign muestra el mensaje del backend.
    }
  }
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

  // Opciones de filtro derivadas de los datos ya cargados (sin fetch aparte,
  // sin /api/influencers/communes — acá alcanzan las ~72 postulantes en memoria).
  // Agrupadas por comuna real (mayúsculas/tildes/espacios distintos del mismo
  // valor) con el mismo criterio que /api/influencers/communes — pedido de
  // Pri 2026-07-13: acá también aparecía duplicada (Copiapó/COPIAPO, Hualpen/
  // Hualpén, La Florida/LA FLORIDA/La florida, etc.) porque esta lista se
  // arma aparte, en memoria, y no pasaba por groupCommunes.
  const pendingCommuneGroups = groupCommunes(
    pendingApplications.map(ci => ci.influencer?.commune).filter((v): v is string => Boolean(v))
  )
  const pendingCategoryOptions = Array.from(new Set(
    pendingApplications.flatMap(ci => ci.influencer?.categories ?? [])
  )).sort()

  const filteredPendingApplications = pendingApplications.filter(ci => {
    const inf = ci.influencer
    if (!inf) return false
    const primarySP = inf.influencer_social_profiles?.[0]

    if (pendingTierFilter && getInfluencerTier(primarySP?.followers ?? 0) !== pendingTierFilter) return false
    if (pendingCommuneFilter && !pendingCommuneFilter.split(',').includes(inf.commune ?? '')) return false
    if (pendingCategoryFilter && !(inf.categories ?? []).includes(pendingCategoryFilter)) return false
    if (pendingMinEngagement > 0 && (primarySP?.engagement_rate ?? 0) < pendingMinEngagement) return false
    if (pendingMinRating > 0 && (inf.rating ?? 0) < pendingMinRating) return false
    if (pendingSearch.trim()) {
      const query = pendingSearch.trim().toLowerCase()
      const handles = (inf.influencer_social_profiles ?? []).map(profile => profile.username ?? '').join(' ')
      if (![inf.display_name, (inf as { email?: string | null }).email ?? '', handles].join(' ').toLowerCase().includes(query)) return false
    }
    return true
  })

  const pendingInvitations = campaignInfluencers.filter(
    ci => ci.application_status === 'pending' && ci.origin === 'invitation'
  )
  // Relaciones activas de la campaña (aceptadas + pendientes; excluye rechazadas)
  // para el contador del tab — así no muestra 0 cuando hay invitaciones pendientes.
  const activeRelations = campaignInfluencers.filter(ci => ci.application_status !== 'rejected')
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
      const handles = (inf.influencer_social_profiles ?? []).map(profile => profile.username ?? '').join(' ')
      if (![inf.display_name, (inf as { email?: string | null }).email ?? '', handles].join(' ').toLowerCase().includes(q)) return false
    }
    return true
  })
  const infFiltersActive = !!(infSearch || infPlatform || infStatus)
  const campaignDeliverables = c.campaign_deliverables ?? []
  const attendanceFor = (ci: typeof confirmedInfluencers[number]) => campaignDeliverables.find(d => {
    const campaignInfluencerId = (d as CampaignDeliverableDetail & { campaign_influencer_id?: string | null }).campaign_influencer_id
    return d.type === 'event_attendance' && (campaignInfluencerId === ci.id || d.influencer?.id === ci.influencer?.id)
  })
  const attendanceConfirmedInfluencers = confirmedInfluencers.filter(ci => attendanceFor(ci)?.attendance_response === 'confirmed' && attendanceFor(ci)?.attendance_outcome !== 'no_show')
  const attendanceDeclinedInfluencers = confirmedInfluencers.filter(ci => attendanceFor(ci)?.attendance_response === 'declined')
  const noShowInfluencers = confirmedInfluencers.filter(ci => attendanceFor(ci)?.attendance_response === 'confirmed' && attendanceFor(ci)?.attendance_outcome === 'no_show')
  const unconfirmedInfluencers = confirmedInfluencers.filter(ci => {
    const attendance = attendanceFor(ci)
    return attendance && !attendance.attendance_response && attendance.attendance_outcome !== 'no_show'
  })
  const noShowInfluencerIds = new Set(noShowInfluencers.map(ci => ci.influencer?.id).filter((id): id is string => Boolean(id)))
  const activeConfirmedInfluencers = confirmedInfluencers.filter(ci => !noShowInfluencerIds.has(ci.influencer?.id ?? ''))
  const attendanceFilteredInfluencers = filteredInfluencers.filter(ci => {
    if (attendanceFilter === 'all') return true
    if (attendanceFilter === 'confirmed') return attendanceConfirmedInfluencers.some(candidate => candidate.id === ci.id)
    if (attendanceFilter === 'declined') return attendanceDeclinedInfluencers.some(candidate => candidate.id === ci.id)
    if (attendanceFilter === 'no_show') return noShowInfluencers.some(candidate => candidate.id === ci.id)
    return unconfirmedInfluencers.some(candidate => candidate.id === ci.id)
  })
  const pendingAttendanceInfluencerIds = Array.from(new Set(campaignDeliverables
    .filter(d => d.type === 'event_attendance' && d.status === 'pending' && !d.attendance_response && !!d.influencer?.id)
    .map(d => d.influencer!.id)))
  const visiblePendingAttendanceInfluencerIds = filteredInfluencers
    .filter(ci => attendanceFilteredInfluencers.some(candidate => candidate.id === ci.id))
    .map(ci => ci.influencer?.id)
    .filter((influencerId): influencerId is string => !!influencerId && pendingAttendanceInfluencerIds.includes(influencerId))

  function setAttendanceReminderSelected(influencerId: string, selected: boolean) {
    setAttendanceReminderSelection(current => {
      const next = new Set(current)
      if (selected) next.add(influencerId)
      else next.delete(influencerId)
      return next
    })
  }

  async function sendAttendanceReminders(influencerIds: string[]) {
    const ids = Array.from(new Set(influencerIds)).filter(Boolean)
    if (!ids.length) return toast.error('Selecciona al menos una influencer pendiente')
    setAttendanceReminderSending(true)
    try {
      const response = await fetch(`/api/campaigns/${id}/attendance-confirmations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remind', influencer_ids: ids }),
      })
      const json = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(json.error ?? 'No se pudo enviar el recordatorio')
      toast.success(`Recordatorio enviado a ${json.data.sent} influencer${json.data.sent === 1 ? '' : 's'}`)
      setAttendanceReminderSelection(current => new Set(Array.from(current).filter(value => !ids.includes(value))))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo enviar el recordatorio')
    } finally {
      setAttendanceReminderSending(false)
    }
  }
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
  // Solo mostrar entregables reales enviados o revisados
  const visibleDeliverables = campaignDeliverables.filter(d => {
    // ocultar asistencia pendiente sin respuesta
    if (d.type === 'event_attendance') {
      return !!d.attendance_response
    }

    // mostrar solo contenido enviado o revisado
    return !!d.content_url ||
           !!d.submitted_at ||
           ['in_review','approved','rejected','published'].includes(d.status)
  })

  const reelDeliverables = campaignDeliverables.filter(d => d.type === 'reel')
  const deliverableCount = reelDeliverables.length
  const deliverableDone  = reelDeliverables.filter(d => d.status === 'published').length
  // Average progress: published=100, others use progress field
  const avgProgress = deliverableCount > 0
    ? Math.round(reelDeliverables.reduce((sum, d) => {
        if (d.status === 'published') return sum + 100
        return sum + (d.progress ?? 0)
      }, 0) / deliverableCount)
    : 0
  const pct = avgProgress

  // Métricas reales de contenido (Apify) agregadas a nivel campaña — solo
  // suma deliverables ya sincronizados (performance != null). No incluye
  // reach/impresiones/guardados/compartidos porque no existen (ver
  // src/lib/deliverables/apify-metrics.ts). Engagement siempre "calculado".
  // El resultado de campaña representa únicamente contenido válido: aprobado
  // o publicado. Si una influencer confirmó pero no asistió, se excluyen todos
  // sus entregables del resultado para no inflar engagement ni visualizaciones.
  const isEligibleCampaignResult = (d: CampaignDeliverableDetail) =>
    !d.influencer?.id || !noShowInfluencerIds.has(d.influencer.id)
  const deliverablesWithMetrics = campaignDeliverables.filter(d =>
    d.type === 'reel' && d.performance != null && isEligibleCampaignResult(d) && (d.status === 'approved' || d.status === 'published')
  )
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
  const briefAsset = campaignAssets.find(asset => {
    const metadata = asset.metadata as Record<string, unknown> | undefined
    return metadata?.asset_type === 'brief'
  })
  const coverAsset = campaignAssets.find(asset => {
    const metadata = asset.metadata as Record<string, unknown> | undefined
    return metadata?.asset_type === 'campaign_cover'
  })
  const canEditCampaign = !isBrandPortal || c._brand_permissions?.canEdit === true
  type CampaignEventBooking = { id?: string; starts_at?: string | null; ends_at?: string | null; location?: string | null; location_details?: { venue_name?: string; instructions?: string; commune?: string } | null }
  const eventBookings = (c as unknown as {
    event_bookings?: CampaignEventBooking[]
    event_booking?: { id?: string; starts_at?: string | null; ends_at?: string | null; location?: string | null; location_details?: { instructions?: string; commune?: string } | null } | null
  }).event_bookings ?? []
  const eventBooking = eventBookings[0] ?? (c as unknown as { event_booking?: CampaignEventBooking | null }).event_booking ?? null
  const eventLocation = eventBooking?.location || c.address || null
  const eventVenueName = eventBooking?.location_details?.venue_name?.trim() || null
  const eventCommune = eventBooking?.location_details?.commune?.trim() || null
  const legacyEventDate = (() => {
    const metadata = (c as unknown as { metadata?: unknown }).metadata
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
    const value = (metadata as Record<string, unknown>).event_date
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null
  })()
  const formatEventTime = (value: string) => {
    const date = new Date(value)
    return `${format(date, 'hh:mm')} ${date.getHours() >= 12 ? 'PM' : 'AM'}`
  }
  const eventStartTime = eventBooking?.starts_at ? formatEventTime(eventBooking.starts_at) : null
  const eventDateLabel = eventBooking?.starts_at
    ? (() => {
        const date = new Date(eventBooking.starts_at)
        const weekday = format(date, 'EEEE', { locale: es }).replace(/^./, letter => letter.toUpperCase())
        const month = format(date, 'MMMM', { locale: es }).replace(/^./, letter => letter.toUpperCase())
        return `${weekday} ${format(date, 'd')} de ${month}`
      })()
    : null
  const eventEndTime = eventBooking?.ends_at ? formatEventTime(eventBooking.ends_at) : null
  const eventTime = eventStartTime ? (eventEndTime ? `${eventStartTime}–${eventEndTime}` : eventStartTime) : null
  // La hora solo es real si existe un booking canónico. Nunca usamos la
  // duración general de la campaña como sustituto del horario del evento.
  const hasEventSchedule = eventBookings.some(booking => Boolean(booking.starts_at && booking.ends_at))
  const eventEndLabel = null
  const eventDateDay = eventBooking?.starts_at ? format(new Date(eventBooking.starts_at), 'dd') : null
  const eventDateMonth = eventBooking?.starts_at ? format(new Date(eventBooking.starts_at), 'MMM', { locale: es }).replace('.', '').toUpperCase() : null
  const eventDateWeekday = eventBooking?.starts_at ? format(new Date(eventBooking.starts_at), 'EEE', { locale: es }).replace('.', '').toUpperCase() : null
  const campaignSummaryName = c.name.replace(/\s*\([^)]*\d{1,2}:\d{2}[^)]*\)\s*$/i, '') || c.name
  const attendanceSuggestedDueDate = eventBooking?.starts_at ? format(new Date(new Date(eventBooking.starts_at).getTime() - 3 * 86400000), 'yyyy-MM-dd') : ''
  const campaignDurationLabel = (() => {
    if (!c.start_date || !c.end_date) return null
    const start = new Date(`${c.start_date}T00:00:00`)
    const end = new Date(`${c.end_date}T00:00:00`)
    const days = Math.round((end.getTime() - start.getTime()) / 86400000)
    if (days <= 0) return 'Mismo día'
    return `${days} día${days === 1 ? '' : 's'}`
  })()

  function openEventEditor() {
    setOverviewEditMode(false)
    setEventForm({
      name: c.name ?? '',
      starts_at: eventBooking?.starts_at ? format(new Date(eventBooking.starts_at), "yyyy-MM-dd'T'HH:mm") : '',
      ends_at: eventBooking?.ends_at ? format(new Date(eventBooking.ends_at), "yyyy-MM-dd'T'HH:mm") : '',
      location: eventLocation ?? '',
      venue_name: eventVenueName ?? '',
      commune: eventCommune ?? '',
      location_instructions: eventBooking?.location_details?.instructions ?? '',
      visibility: c.visibility === 'open' ? 'open' : 'private',
    })
    setEditingEvent(true)
  }

  function openSummaryEditor() {
    setEditingEvent(false)
    setSummaryEditForm({
      name: c.name ?? '',
      start_date: c.start_date ?? '',
      end_date: c.end_date ?? '',
      visibility: c.visibility === 'open' ? 'open' : 'private',
      venue_name: eventVenueName ?? '',
      location: eventLocation ?? c.address ?? '',
      location_instructions: eventBooking?.location_details?.instructions ?? '',
    })
    setEventScheduleForm(eventBookings.length > 0
      ? eventBookings.map(booking => ({
          id: booking.id,
          starts_at: booking.starts_at ? format(new Date(booking.starts_at), "yyyy-MM-dd'T'HH:mm") : '',
          ends_at: booking.ends_at ? format(new Date(booking.ends_at), "yyyy-MM-dd'T'HH:mm") : '',
        }))
      // Campañas antiguas podían guardar solo la fecha en metadata. Dejamos
      // una fila lista para completar la hora real, sin inventar un horario.
      : [{ starts_at: '', ends_at: '' }]
    )
    setSummaryEditOpen(true)
  }

  function openTimeEditor() {
    openSummaryEditor()
    setSummaryEditOpen(false)
    const booking = eventBookings[0]
    setTimeEditForm({
      date: booking?.starts_at ? format(new Date(booking.starts_at), 'yyyy-MM-dd') : '',
      start_time: booking?.starts_at ? format(new Date(booking.starts_at), 'HH:mm') : '',
      end_time: booking?.ends_at ? format(new Date(booking.ends_at), 'HH:mm') : '',
    })
    setTimeEditOpen(true)
  }

  function addEventDay() {
    const last = eventScheduleForm[eventScheduleForm.length - 1]
    if (last?.starts_at) {
      const nextStart = new Date(last.starts_at)
      nextStart.setDate(nextStart.getDate() + 1)
      const nextEnd = last.ends_at ? new Date(last.ends_at) : new Date(nextStart)
      if (last.ends_at) nextEnd.setDate(nextEnd.getDate() + 1)
      setEventScheduleForm(previous => [...previous, {
        starts_at: format(nextStart, "yyyy-MM-dd'T'HH:mm"),
        ends_at: last.ends_at ? format(nextEnd, "yyyy-MM-dd'T'HH:mm") : '',
      }])
      return
    }
    setEventScheduleForm(previous => [...previous, { starts_at: '', ends_at: '' }])
  }

  async function saveSummaryEditor(
    schedule: Array<{ id?: string; starts_at: string; ends_at: string }> = eventScheduleForm,
  ) {
    if (!summaryEditForm.name.trim()) return toast.error('Completa el nombre de la campaña')
    const incompleteEventDay = schedule.some(day => Boolean(day.starts_at) !== Boolean(day.ends_at))
    if (incompleteEventDay) return toast.error('Completa inicio y término de cada día del evento')
    setSummaryEditSaving(true)
    try {
      await patchCampaign.mutateAsync({
        name: summaryEditForm.name.trim(),
        start_date: summaryEditForm.start_date || null,
        end_date: summaryEditForm.end_date || null,
        visibility: summaryEditForm.visibility,
        address: summaryEditForm.location.trim() || null,
      })
      const savedIds = new Set(schedule.flatMap(day => day.id ? [day.id] : []))
      const daysToRemove = eventBookings.filter(day => day.id && !savedIds.has(day.id))
      for (const day of daysToRemove) {
        const response = await fetch(`/api/bookings?id=${day.id}`, { method: 'DELETE' })
        if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? 'No se pudo quitar un día del evento')
      }
      for (const day of schedule) {
        // Las filas vacías son solo un borrador visual; no crean eventos vacíos.
        if (!day.starts_at && !day.ends_at) continue
        const payload = {
          title: summaryEditForm.name.trim(),
          description: c.description ?? '',
          location: summaryEditForm.location.trim() || null,
          location_details: {
            ...(eventBooking?.location_details ?? {}),
            venue_name: summaryEditForm.venue_name.trim() || null,
            instructions: summaryEditForm.location_instructions.trim() || null,
          },
          starts_at: new Date(day.starts_at).toISOString(),
          ends_at: new Date(day.ends_at).toISOString(),
          timezone: 'America/Santiago',
        }
        const response = await fetch('/api/bookings', {
          method: day.id ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(day.id ? { id: day.id, ...payload } : { campaign_id: id, event_type: 'event', ...payload }),
        })
        if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? 'No se pudo guardar un día del evento')
      }
      await refetch()
      setSummaryEditOpen(false)
      setTimeEditOpen(false)
      toast.success('Resumen de campaña actualizado')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar la campaña')
    } finally {
      setSummaryEditSaving(false)
    }
  }

  function saveTimeEditor() {
    if (!timeEditForm.date || !timeEditForm.start_time || !timeEditForm.end_time) {
      toast.error('Completa fecha, hora de inicio y hora de término')
      return
    }
    void saveSummaryEditor([{
      id: eventBookings[0]?.id,
      starts_at: `${timeEditForm.date}T${timeEditForm.start_time}`,
      ends_at: `${timeEditForm.date}T${timeEditForm.end_time}`,
    }])
  }

  function openLocationEditor() {
    const address = eventLocation ?? c.address
    if (address) window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`, '_blank', 'noopener,noreferrer')
  }

  async function saveLocation() {
    setLocationEditSaving(true)
    try {
      const address = locationEditForm.address.trim()
      const locationDetails = {
        ...(eventBooking?.location_details ?? {}),
        venue_name: locationEditForm.venueName.trim() || null,
        instructions: locationEditForm.instructions.trim() || null,
      }
      // Todos los días del mismo evento comparten la misma ubicación.
      for (const booking of eventBookings) {
        if (!booking.id) continue
        const response = await fetch('/api/bookings', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: booking.id, title: c.name, description: c.description ?? '',
            location: address || null, location_details: locationDetails,
            starts_at: booking.starts_at ?? undefined, ends_at: booking.ends_at ?? undefined,
            timezone: 'America/Santiago',
          }),
        })
        const json = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(json.error ?? 'No se pudo actualizar la ubicación')
      }
      await patchCampaign.mutateAsync({ address: address || null })
      await refetch()
      setLocationEditOpen(false)
      toast.success('Ubicación actualizada')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo actualizar la ubicación')
    } finally {
      setLocationEditSaving(false)
    }
  }

  async function saveEvent() {
    if (!eventForm.name.trim() || !eventForm.starts_at || !eventForm.ends_at || !eventForm.location.trim()) {
      toast.error('Completa nombre, fecha, hora y ubicación del evento')
      return
    }
    setEventSaving(true)
    try {
      const startsAt = new Date(eventForm.starts_at).toISOString()
      const endsAt = new Date(eventForm.ends_at).toISOString()
      const locationDetails = { venue_name: eventForm.venue_name.trim(), instructions: eventForm.location_instructions.trim(), commune: eventForm.commune.trim() }
      const bookingPayload = eventBooking?.id
        ? { id: eventBooking.id, title: eventForm.name.trim(), description: c.description ?? '', location: eventForm.location.trim(), location_details: locationDetails, starts_at: startsAt, ends_at: endsAt, timezone: 'America/Santiago' }
        : { campaign_id: id, title: eventForm.name.trim(), description: c.description ?? '', event_type: 'event', location: eventForm.location.trim(), location_details: locationDetails, starts_at: startsAt, ends_at: endsAt, timezone: 'America/Santiago' }
      const response = await fetch('/api/bookings', {
        method: eventBooking?.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bookingPayload),
      })
      const json = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(json.error ?? 'No se pudo guardar el evento')
      await patchCampaign.mutateAsync({
        name: eventForm.name.trim(),
        address: eventForm.location.trim(),
        visibility: eventForm.visibility,
      })
      await refetch()
      setEditingEvent(false)
      toast.success('Fecha y ubicación actualizadas')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar el evento')
    } finally {
      setEventSaving(false)
    }
  }

  async function reloadCampaignAssets() {
    const res = await fetch(`/api/campaigns/${id}/assets`)
    const json = await res.json().catch(() => ({}))
    setCampaignAssets(Array.isArray(json.data) ? json.data : [])
  }

  async function reloadCampaignInvoices() {
    const res = await fetch(`/api/invoices?campaign_id=${id}&limit=50`)
    const json = await res.json().catch(() => ({}))
    setCampaignInvoices(res.ok && Array.isArray(json.data) ? json.data : [])
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

  async function handleUploadBrief(file: File) {
    if (file.size > 4 * 1024 * 1024) {
      toast.error('El brief debe pesar máximo 4 MB. Comprímelo e inténtalo nuevamente.')
      return
    }
    setBriefSaving(true)
    try {
      const api = `/api/campaigns/${id}/assets`
      const prepare = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create_signed_upload', filename: file.name, size_bytes: file.size }) })
      const prepared = await prepare.json().catch(() => ({}))
      if (!prepare.ok || !prepared.token || !prepared.storagePath) throw new Error(prepared.error ?? 'No se pudo preparar la carga del brief')

      const { error: uploadError } = await createClient().storage.from('campaign-assets').uploadToSignedUrl(prepared.storagePath, prepared.token, file)
      if (uploadError) throw new Error(uploadError.message)

      const res = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'register_signed_upload', filename: file.name, storage_path: prepared.storagePath, mime_type: file.type || null, size_bytes: file.size, asset_type: 'brief' }) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'No se pudo registrar el brief')

      if (briefAsset?.id) {
        await fetch(`/api/campaigns/${id}/assets/${String(briefAsset.id)}`, { method: 'DELETE' })
      }
      await reloadCampaignAssets()
      toast.success('Brief cargado correctamente')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo cargar el brief')
    } finally {
      setBriefSaving(false)
    }
  }

  async function handleUploadCampaignCover(file: File) {
    if (!file.type.startsWith('image/')) return toast.error('La portada debe ser una imagen JPG, PNG o WebP')
    if (file.size > 5 * 1024 * 1024) return toast.error('La portada no puede superar 5 MB')
    setCoverSaving(true)
    try {
      const formData = new FormData()
      formData.append('filename', `Portada · ${c.name}`)
      formData.append('asset_type', 'campaign_cover')
      formData.append('file', file)
      const res = await fetch(`/api/campaigns/${id}/assets`, { method: 'POST', body: formData })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'No se pudo subir la portada')
      if (coverAsset?.id) await fetch(`/api/campaigns/${id}/assets/${String(coverAsset.id)}`, { method: 'DELETE' })
      await reloadCampaignAssets()
      toast.success('Portada de campaña actualizada')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo subir la portada')
    } finally {
      setCoverSaving(false)
      if (coverInputRef.current) coverInputRef.current.value = ''
    }
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
          location_type: locationForm.location_type,
          name: locationForm.name.trim(),
          address: locationForm.address.trim() || null,
          city: locationForm.city.trim() || null,
          region: locationForm.region.trim() || null,
          country: locationForm.country.trim() || 'Chile',
          is_public: locationForm.location_type === 'home' ? false : locationForm.is_public,
          notes: locationForm.notes.trim() || null,
        }),
      })

      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Error al crear lugar')

      setLocationForm({
        location_type: 'store',
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

  function goToKpiSection(target: Tab, openPendingApplications = false) {
    setTab(target)
    if (openPendingApplications) setPendingApplicationsOpen(true)
  }

  function showAttendanceKpi(filter: 'confirmed' | 'declined' | 'no_show' | 'unconfirmed') {
    setAttendanceFilter(filter)
    setTab('influencers')
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
      toast.success(action === 'submit_for_approval' ? 'Campaña enviada a revisión' : action === 'activate' ? 'Campaña activada' : 'Estado actualizado')
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

  async function handleDuplicateCampaign() {
    if (duplicatingCampaign) return
    setDuplicatingCampaign(true)
    try {
      const response = await fetch(`/api/campaigns/${id}/duplicate`, { method: 'POST' })
      const json = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(json.error ?? 'No se pudo duplicar la campaña')
      toast.success('Campaña duplicada como borrador')
      router.push(isBrandPortal ? `/brand-campaigns/${json.data.id}` : `/admin-campaigns/${json.data.id}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo duplicar la campaña')
    } finally {
      setDuplicatingCampaign(false)
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
    { id: 'influencers',  label: `Influencers (${isBrandPortal ? confirmedInfluencers.length : activeRelations.length})`, icon: <Users className="h-3.5 w-3.5" /> },
    { id: 'deliverables', label: `Deliverables (${deliverableCount})`,           icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
    { id: 'barters',      label: 'Canjes',        icon: <Gift className="h-3.5 w-3.5" /> },
    { id: 'assets',       label: `Assets (${campaignAssets.length})`, icon: <FileText className="h-3.5 w-3.5" /> },
    { id: 'locations',    label: `Lugares (${brandLocations.length})`, icon: <Target className="h-3.5 w-3.5" /> },
    { id: 'billing',      label: `Facturas (${campaignInvoices.length})`, icon: <DollarSign className="h-3.5 w-3.5" /> },
    { id: 'history',      label: 'Historial',     icon: <Clock className="h-3.5 w-3.5" /> },
  ]

  return (
    <div className="space-y-5">
      {/* Breadcrumb + actions */}
      <div className="flex items-center justify-between">
        <div className="min-w-0">
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
          <p className="mt-1 text-xs capitalize text-gray-400">{format(new Date(), "EEEE d 'de' MMMM", { locale: es })}</p>
        </div>
        <div className="flex items-center gap-2">
          {canEditCampaign && (
            <button
              type="button"
              onClick={() => void handleDuplicateCampaign()}
              disabled={duplicatingCampaign}
              title="Duplicar campaña como borrador"
              aria-label="Duplicar campaña como borrador"
              className="flex items-center justify-center p-2 text-violet-700 bg-violet-50 border border-violet-200 rounded-lg hover:bg-violet-100 disabled:opacity-50 transition-colors"
            >
              {duplicatingCampaign ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          )}
          <Link href={isBrandPortal ? `/brand-campaigns/${id}/report` : `/admin-campaigns/${id}/report`} target="_blank" rel="noopener noreferrer"
            title="Reporte PDF"
            className="flex items-center justify-center p-2 text-violet-700 bg-violet-50 border border-violet-200 rounded-lg hover:bg-violet-100 transition-colors">
            <FileDown className="h-3.5 w-3.5" />
          </Link>
          {c.status === 'draft' && (
            isBrandPortal ? (
              <button
                onClick={() => handleStatusAction('submit_for_approval')}
                disabled={patchCampaign.isPending}
                title="Enviar campaña a revisión"
                className="flex items-center gap-1.5 px-3 py-2 text-violet-700 bg-violet-50 border border-violet-200 rounded-lg hover:bg-violet-100 disabled:opacity-50 transition-colors"
              >
                <Check className="h-3.5 w-3.5" />
                <span className="text-xs font-semibold">Enviar a revisión</span>
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
          {!isBrandPortal && (c.status === 'pending_approval' || c.status === 'paused') && (
            <button onClick={() => handleStatusAction('activate')} disabled={patchCampaign.isPending}
              title={c.status === 'paused' ? 'Reactivar' : 'Activar'}
              className="flex items-center justify-center p-2 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 disabled:opacity-50 transition-colors">
              <Play className="h-3.5 w-3.5" />
            </button>
          )}
          {c.status === 'active' && (
            <>
              {c.visibility === 'open' && (!isBrandPortal || c._brand_permissions?.canEdit) && (
                <button
                  onClick={() => handleStatusAction(c.applications_closed_at ? 'reopen_applications' : 'close_applications')}
                  disabled={patchCampaign.isPending}
                  title={c.applications_closed_at ? 'Reabrir postulaciones' : 'Cerrar postulaciones sin pausar la campaña'}
                  className="flex items-center gap-1.5 px-3 py-2 text-violet-700 bg-violet-50 border border-violet-200 rounded-lg hover:bg-violet-100 disabled:opacity-50 transition-colors"
                >
                  <span className="text-xs font-semibold">{c.applications_closed_at ? 'Reabrir postulaciones' : 'Cerrar postulaciones'}</span>
                </button>
              )}
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

      {/* Resumen del evento: la hora y el lugar son la información principal. */}
      <div className="card overflow-hidden p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
          <div className="flex-shrink-0">
            <div className="flex h-20 gap-2">
            {eventDateDay && <div className="flex w-14 flex-col items-center justify-center rounded-xl border border-gray-200 bg-white text-center"><span className="text-[10px] font-bold tracking-wide text-violet-700">{eventDateWeekday}</span><span className="text-2xl font-bold leading-none text-gray-950">{eventDateDay}</span><span className="text-[10px] font-semibold text-gray-500">{eventDateMonth}</span></div>}
            <div className="relative w-28 overflow-hidden rounded-xl border border-violet-100 bg-violet-50 shadow-sm">
              {coverAsset?.signed_url ? <img src={String(coverAsset.signed_url)} alt="Banner de campaña" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center"><Target className="h-7 w-7 text-violet-500" /></div>}
              {canEditCampaign && <><input ref={coverInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={event => { const file = event.target.files?.[0]; if (file) void handleUploadCampaignCover(file) }} /><button type="button" onClick={() => coverInputRef.current?.click()} disabled={coverSaving} title={coverAsset ? 'Cambiar banner' : 'Subir banner'} aria-label={coverAsset ? 'Cambiar banner' : 'Subir banner'} className="absolute bottom-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-white text-violet-700 shadow-md transition hover:bg-violet-700 hover:text-white disabled:opacity-50"><ImagePlus className="h-3.5 w-3.5" /></button></>}
            </div>
            </div>
            {!editingEvent && (c.start_date || c.end_date) && <div className="mt-2 flex max-w-48 items-start gap-1.5 rounded-lg bg-gray-50 px-2 py-1.5 text-[11px] font-medium leading-tight text-gray-600"><Calendar className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-600" /><span>Campaña: {c.start_date ? formatDate(c.start_date) : 'Por confirmar'}{c.end_date ? ` – ${formatDate(c.end_date)}` : ''}{campaignDurationLabel ? ` · ${campaignDurationLabel}` : ''}</span></div>}
          </div>
          <div className="min-w-0 flex-1 lg:min-w-[260px]">
            <div className="mb-1 flex items-center gap-1.5">
              {Boolean(campaignBrands[0]?.name) && (
                <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-gray-500">{String(campaignBrands[0].name)}</p>
              )}
              {canEditCampaign && (summaryEditOpen ? <div className="flex items-center gap-1"><button type="button" onClick={() => setSummaryEditOpen(false)} disabled={summaryEditSaving} className="rounded px-2 py-1 text-xs font-semibold text-gray-500 hover:bg-gray-100">Cancelar</button><button type="button" onClick={() => void saveSummaryEditor()} disabled={summaryEditSaving} className="rounded-md bg-violet-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50">{summaryEditSaving ? 'Guardando…' : 'Guardar'}</button></div> : <button type="button" onClick={openSummaryEditor} title="Editar resumen de campaña" className="rounded p-1 text-gray-400 hover:bg-violet-50 hover:text-violet-700"><Pencil className="h-3 w-3" /></button>)}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {editingEvent ? <input value={eventForm.name} onChange={e => setEventForm(previous => ({ ...previous, name: e.target.value }))} className="min-w-0 flex-1 rounded border border-violet-300 bg-white px-2 py-1 text-base font-bold text-gray-900 outline-none focus:ring-2 focus:ring-violet-100" /> : summaryEditOpen ? <input value={summaryEditForm.name} onChange={event => setSummaryEditForm(previous => ({ ...previous, name: event.target.value }))} aria-label="Nombre de campaña" className="h-9 min-w-[220px] flex-1 rounded-lg border border-violet-300 bg-white px-2 text-xl font-bold tracking-tight text-gray-900 outline-none focus:ring-2 focus:ring-violet-100" /> : <h1 className="text-xl font-bold text-gray-900 tracking-tight truncate">{campaignSummaryName}</h1>}
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
              {canEditCampaign && !coverAsset && <button type="button" onClick={() => coverInputRef.current?.click()} disabled={coverSaving} className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 px-2.5 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-50" title="JPG, PNG o WebP · máximo 5 MB"><ImagePlus className="h-3.5 w-3.5" />{coverSaving ? 'Subiendo…' : 'Subir banner'}</button>}
            </div>
                        {editingEvent && <label className="mt-3 block max-w-md text-xs font-semibold text-gray-600">Nombre del lugar<input value={eventForm.venue_name} onChange={e => setEventForm(previous => ({ ...previous, venue_name: e.target.value }))} placeholder="Ej. Hotel Marriott Santiago" className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm font-semibold text-gray-800 outline-none" /></label>}
            {editingEvent && <div className="mt-3 flex items-center gap-2"><label className="text-xs font-semibold text-gray-600">Visibilidad</label><select value={eventForm.visibility} onChange={e => setEventForm(previous => ({ ...previous, visibility: e.target.value }))} className="rounded-lg border border-violet-200 bg-white px-2 py-1.5 text-xs font-semibold text-gray-800 outline-none"><option value="private">Privada</option><option value="open">Pública</option></select></div>}
            {editingEvent ? <div className="mt-3 grid max-w-3xl gap-2 sm:grid-cols-2"><div className="flex items-center gap-2"><Calendar className="h-4 w-4 flex-shrink-0 text-violet-600" /><div className="grid min-w-0 flex-1 gap-1 sm:grid-cols-2"><input type="datetime-local" value={eventForm.starts_at} onChange={e => setEventForm(previous => ({ ...previous, starts_at: e.target.value }))} className="min-w-0 rounded-lg border border-violet-200 bg-white px-2 py-1.5 text-xs outline-none" /><input type="datetime-local" value={eventForm.ends_at} onChange={e => setEventForm(previous => ({ ...previous, ends_at: e.target.value }))} className="min-w-0 rounded-lg border border-violet-200 bg-white px-2 py-1.5 text-xs outline-none" /></div></div><div className="space-y-1"><div className="flex items-center gap-2"><MapPin className="h-4 w-4 flex-shrink-0 text-violet-600" /><input value={eventForm.location} placeholder="Dirección o lugar" onChange={e => setEventForm(previous => ({ ...previous, location: e.target.value }))} className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm font-semibold text-gray-800 outline-none" /></div><div className="grid gap-1 sm:grid-cols-2"><input list="event-communes" value={eventForm.commune} placeholder="Comuna" onChange={e => setEventForm(previous => ({ ...previous, commune: e.target.value }))} className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 outline-none" /><datalist id="event-communes">{COMUNAS_CHILE.map(commune => <option key={commune} value={commune} />)}</datalist><input value={eventForm.location_instructions} placeholder="Indicaciones (opcional)" onChange={e => setEventForm(previous => ({ ...previous, location_instructions: e.target.value }))} className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 outline-none" /></div></div></div> : <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm"><>{eventBookings.map((booking, index) => { const start = booking.starts_at ? format(new Date(booking.starts_at), "EEE d MMM", { locale: es }) : null; const startTime = booking.starts_at ? formatEventTime(booking.starts_at) : null; const endTime = booking.ends_at ? formatEventTime(booking.ends_at) : null; return start && startTime ? <span key={booking.id ?? index} className="inline-flex items-center gap-2 font-medium text-gray-800"><Calendar className="h-4 w-4 text-violet-600" />{start.replace(/^./, letter => letter.toUpperCase())} <Clock className="ml-1 h-4 w-4 text-violet-600" />{endTime ? `${startTime}–${endTime}` : startTime}</span> : null })}{!hasEventSchedule && (canEditCampaign ? <div className="relative"><button type="button" onClick={openTimeEditor} className="inline-flex items-center gap-2 font-semibold text-amber-700 hover:underline"><Clock className="h-4 w-4 text-amber-600" />Hora por confirmar</button>{timeEditOpen && <div className="absolute left-0 top-8 z-40 w-[min(340px,calc(100vw-2rem))] rounded-xl border border-violet-200 bg-white p-3 shadow-xl"><div className="grid grid-cols-2 gap-2"><input type="date" value={timeEditForm.date} onChange={event => setTimeEditForm(previous => ({ ...previous, date: event.target.value }))} aria-label="Fecha del evento" className="input-base col-span-2 w-full" /><input type="time" value={timeEditForm.start_time} onChange={event => setTimeEditForm(previous => ({ ...previous, start_time: event.target.value }))} aria-label="Hora de inicio" className="input-base w-full" /><input type="time" value={timeEditForm.end_time} onChange={event => setTimeEditForm(previous => ({ ...previous, end_time: event.target.value }))} aria-label="Hora de término" className="input-base w-full" /></div><div className="mt-2 flex justify-end gap-2"><button type="button" onClick={() => setTimeEditOpen(false)} disabled={summaryEditSaving} className="px-2 py-1.5 text-xs font-semibold text-gray-500">Cancelar</button><button type="button" onClick={saveTimeEditor} disabled={summaryEditSaving} className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{summaryEditSaving ? 'Guardando…' : 'Guardar'}</button></div></div>}</div> : <span className="inline-flex items-center gap-2 font-semibold text-amber-700"><Clock className="h-4 w-4 text-amber-600" />Hora por confirmar</span>)}<div className="relative inline-flex min-w-0 items-center gap-2 text-gray-800"><MapPin className="h-4 w-4 shrink-0 text-violet-600" />{canEditCampaign ? <button type="button" onClick={openLocationEditor} className="truncate text-left hover:text-violet-700 hover:underline" title="Abrir ubicación en Google Maps">{eventLocation ?? 'Ubicación por confirmar'}{eventCommune ? `, ${eventCommune}` : ''}</button> : <span className="truncate">{eventLocation ?? 'Ubicación por confirmar'}{eventCommune ? `, ${eventCommune}` : ''}</span>}{locationEditOpen && <div className="absolute left-0 top-7 z-40 w-[min(360px,calc(100vw-2rem))] rounded-xl border border-violet-200 bg-white p-3 shadow-xl"><label className="block text-xs font-semibold text-gray-700">Ubicación del evento</label><input autoFocus value={locationEditValue} onChange={event => setLocationEditValue(event.target.value)} placeholder="Dirección o lugar" className="input-base mt-1 w-full" /><div className="mt-2 flex justify-end gap-2"><button type="button" onClick={() => setLocationEditOpen(false)} disabled={locationEditSaving} className="px-2 py-1 text-xs font-semibold text-gray-500 hover:text-gray-800">Cancelar</button><button type="button" onClick={() => void saveLocation()} disabled={locationEditSaving} className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{locationEditSaving ? 'Guardando…' : 'Guardar'}</button></div></div>}</div><span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500"><FileText className="h-4 w-4 text-violet-600" />{(briefAsset?.signed_url || c.brief_url) ? <a href={String(briefAsset?.signed_url ?? c.brief_url)} target="_blank" rel="noopener noreferrer" className="font-semibold text-violet-700 hover:underline">Brief</a> : <span>Sin brief</span>}{canEditCampaign && <><input ref={briefInputRef} type="file" accept=".pdf,.doc,.docx,image/*" className="hidden" onChange={event => { const file = event.target.files?.[0]; event.currentTarget.value = ''; if (file) void handleUploadBrief(file) }} /><button type="button" onClick={() => briefInputRef.current?.click()} disabled={briefSaving} title={(briefAsset || c.brief_url) ? 'Reemplazar brief' : 'Subir brief'} aria-label={(briefAsset || c.brief_url) ? 'Reemplazar brief' : 'Subir brief'} className="rounded p-1 text-violet-700 hover:bg-violet-50 disabled:opacity-50">{briefSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}</button></>}</span></></div>}
            {!editingEvent && !timeEditOpen && (eventVenueName || eventBooking?.location_details?.instructions?.trim()) && <p className="mt-2 flex max-w-3xl items-center gap-2 text-xs text-gray-500"><MapPin className="h-3.5 w-3.5 shrink-0 text-violet-500" />{eventVenueName && <span className="font-semibold text-gray-700">{eventVenueName}</span>}{eventVenueName && eventBooking?.location_details?.instructions?.trim() && <span>·</span>}{eventBooking?.location_details?.instructions?.trim() && <span>{eventBooking.location_details.instructions.trim()}</span>}</p>}
          </div>
          <div className="grid w-full grid-cols-3 gap-2 lg:w-[480px] lg:grid-cols-4 lg:flex-none">
            <button type="button" onClick={() => showAttendanceKpi('confirmed')} className="rounded-lg bg-emerald-50 px-2 py-1.5 text-center transition hover:bg-emerald-100 hover:ring-1 hover:ring-emerald-200 focus:outline-none focus:ring-2 focus:ring-emerald-300" title="Ver confirmadas que asistieron">
              <div className="text-sm font-bold text-emerald-700">{attendanceConfirmedInfluencers.length}</div>
              <div className="text-[10px] font-medium text-emerald-700">Confirmaron</div>
            </button>
            <button type="button" onClick={() => showAttendanceKpi('no_show')} className="rounded-lg bg-gray-100 px-2 py-1.5 text-center transition hover:bg-gray-200 hover:ring-1 hover:ring-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400" title="Ver confirmadas que no asistieron">
              <div className="text-sm font-bold text-gray-700">{noShowInfluencers.length}</div>
              <div className="text-[10px] font-medium text-gray-600">No asistieron</div>
            </button>
            <button type="button" onClick={() => showAttendanceKpi('declined')} className="rounded-lg bg-rose-50 px-2 py-1.5 text-center transition hover:bg-rose-100 hover:ring-1 hover:ring-rose-200 focus:outline-none focus:ring-2 focus:ring-rose-300" title="Ver quienes avisaron que no podrán asistir">
              <div className="text-sm font-bold text-rose-700">{attendanceDeclinedInfluencers.length}</div>
              <div className="text-[10px] font-medium text-rose-700">No podrán asistir</div>
            </button>
            <button type="button" onClick={() => showAttendanceKpi('unconfirmed')} className="rounded-lg bg-amber-50 px-2 py-1.5 text-center transition hover:bg-amber-100 hover:ring-1 hover:ring-amber-200 focus:outline-none focus:ring-2 focus:ring-amber-300" title="Ver aprobadas que no confirmaron asistencia">
              <div className="text-sm font-bold text-amber-700">{unconfirmedInfluencers.length}</div>
              <div className="text-[10px] font-medium text-amber-700">No confirmaron</div>
            </button>
            <button type="button" onClick={() => goToKpiSection('influencers', true)} className="rounded-lg bg-gray-50 px-2 py-1.5 text-center transition hover:bg-violet-50 hover:ring-1 hover:ring-violet-200 focus:outline-none focus:ring-2 focus:ring-violet-300" title="Ver solicitudes pendientes">
              <div className="text-sm font-bold text-gray-900">{pendingApplications.length}</div>
              <div className="text-[10px] font-medium text-gray-500">Postularon</div>
            </button>
            <button type="button" onClick={() => goToKpiSection('overview')} className="rounded-lg bg-gray-50 px-2 py-1.5 text-center transition hover:bg-violet-50 hover:ring-1 hover:ring-violet-200 focus:outline-none focus:ring-2 focus:ring-violet-300" title="Ver marcas participantes">
              <div className="text-sm font-bold text-gray-900">{campaignBrands.length}</div>
              <div className="text-[10px] font-medium text-gray-500">Marcas</div>
            </button>
            <button type="button" onClick={() => goToKpiSection('overview')} className="rounded-lg bg-blue-50 px-2 py-1.5 text-center transition hover:bg-blue-100 hover:ring-1 hover:ring-blue-200 focus:outline-none focus:ring-2 focus:ring-blue-300" title="Ver resumen de campaña">
              <div className="text-sm font-bold text-blue-700">{c.visibility === 'open' ? 'Pública' : 'Privada'}</div>
              <div className="text-[10px] font-medium text-blue-600">Visibilidad</div>
            </button>
            <button type="button" onClick={() => goToKpiSection('influencers', true)} className={cn('rounded-lg px-2 py-1.5 text-center transition hover:ring-1 focus:outline-none focus:ring-2', c.applications_closed_at ? 'bg-amber-50 hover:bg-amber-100 hover:ring-amber-200 focus:ring-amber-300' : 'bg-emerald-50 hover:bg-emerald-100 hover:ring-emerald-200 focus:ring-emerald-300')} title="Ver postulaciones">
              <div className={cn('text-xs font-bold', c.applications_closed_at ? 'text-amber-700' : 'text-emerald-700')}>{c.visibility === 'open' ? (c.applications_closed_at ? 'Cerradas' : 'Abiertas') : 'No aplica'}</div>
              <div className={cn('text-[10px] font-medium', c.applications_closed_at ? 'text-amber-700' : 'text-emerald-700')}>Postulaciones</div>
            </button>
            <button type="button" onClick={() => goToKpiSection('deliverables')} className="rounded-lg bg-gray-50 px-2 py-1.5 text-center transition hover:bg-violet-50 hover:ring-1 hover:ring-violet-200 focus:outline-none focus:ring-2 focus:ring-violet-300" title="Ver métricas de entregables">
              <div className="text-sm font-bold text-gray-900">{hasCampaignMetrics ? formatFollowers(totalViews) : '—'}</div>
              <div className="text-[10px] font-medium text-gray-500">Visualizaciones</div>
            </button>
            <button type="button" onClick={() => goToKpiSection('deliverables')} className="rounded-lg bg-gray-50 px-2 py-1.5 text-center transition hover:bg-violet-50 hover:ring-1 hover:ring-violet-200 focus:outline-none focus:ring-2 focus:ring-violet-300" title="Ver métricas de entregables">
              <div className="text-sm font-bold text-gray-900">{hasCampaignMetrics ? formatFollowers(totalInteractionsMetrics) : '—'}</div>
              <div className="text-[10px] font-medium text-gray-500">Engagement total</div>
            </button>
            <button type="button" onClick={() => goToKpiSection('deliverables')} className="rounded-lg bg-gray-50 px-2 py-1.5 text-center transition hover:bg-violet-50 hover:ring-1 hover:ring-violet-200 focus:outline-none focus:ring-2 focus:ring-violet-300" title="Ver entregables">
              <div className="text-sm font-bold text-gray-900">{deliverableDone}/{deliverableCount}</div>
              <div className="text-[10px] font-medium text-gray-500">Entregables publicados</div>
            </button>
            <button type="button" onClick={() => goToKpiSection('deliverables')} className="rounded-lg bg-gray-50 px-2 py-1.5 text-center transition hover:bg-violet-50 hover:ring-1 hover:ring-violet-200 focus:outline-none focus:ring-2 focus:ring-violet-300" title="Ver métricas de entregables">
              <div className="text-sm font-bold text-gray-900">—</div>
              <div className="text-[10px] font-medium text-gray-500">Alcance total</div>
            </button>
          </div>
        </div>
      </div>

      {/* Tabs — achicados (pedido de Pri: "arregla la ui que se vea bien") */}
      <div className="border-b border-gray-200">
        <div className="flex gap-1 overflow-x-auto">
          {TABS.map(t => (
            <button key={t.id} onClick={() => selectTab(t.id)}
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
        editingOverview ? (
          <OverviewEditPanel
            key={c.updated_at}
            campaign={c}
            saving={patchCampaign.isPending}
            isBrandPortal={isBrandPortal}
            section={overviewEditSection}
            onCancel={() => setOverviewEditMode(false)}
            onSave={saveOverview}
          />
        ) : <>
        {(campaignBrands.length > 0 || (!isBrandPortal || c._brand_permissions?.canEdit)) && (
          <CampaignBrandsPanel
            campaignId={id}
            brands={campaignBrands.map(brand => ({
              id: String(brand.id ?? ''),
              name: String(brand.name ?? ''),
              logo_url: brand.logo_url as string | null,
              instagram: brand.instagram as string | null,
              _role: String(brand._role ?? ''),
            }))}
            canManage={!isBrandPortal || c._brand_permissions?.canEdit === true}
            canChangePrimary={!isBrandPortal}
            onChanged={() => void refetch()}
          />
        )}
        <div className="space-y-4">
            {/* Guías de contenido — movida arriba (antes al final de la columna,
                casi invisible después de scrollear). Pri: "necesito que al abrir
                el overview lo entienda por completo las marcas... las guías de
                contenido" — es lo primero que una marca necesita leer para saber
                qué se espera de la campaña. */}
            {(
              <div className="card p-5 border-2 border-violet-100 bg-violet-50/20">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <h3 className="text-sm font-semibold text-violet-800 flex items-center gap-2"><FileText className="h-4 w-4" /> Guías de contenido</h3>
                  {(!isBrandPortal || c._brand_permissions?.canEdit) && <button type="button" onClick={() => setOverviewEditMode(true, 'content')} className="text-xs font-semibold text-violet-700 hover:underline">Editar</button>}
                </div>
                {c.content_guidelines ? <>
                  <p className="text-sm leading-relaxed text-gray-700 whitespace-pre-wrap line-clamp-4">{c.content_guidelines}</p>
                  {c.content_guidelines.length > 420 && <details className="mt-2"><summary className="cursor-pointer text-xs font-semibold text-violet-700">Ver guía completa</summary><p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-gray-700">{c.content_guidelines}</p></details>}
                </> : <p className="text-sm text-gray-400">Aún no hay guías de contenido.</p>}
              </div>
            )}

            {/* Deliverable templates */}
            {(
              <div className="card p-5">
                <div className="flex items-center justify-between gap-3 mb-3"><h3 className="text-sm font-semibold text-gray-700">Deliverables requeridos por campaña</h3>{(!isBrandPortal || c._brand_permissions?.canEdit) && <button type="button" onClick={() => setOverviewEditMode(true, 'deliverables')} className="text-xs font-semibold text-violet-700 hover:underline">Editar</button>}</div>
                {(c.deliverable_templates?.length ?? 0) > 0 ? <div className="space-y-2">
                  {c.deliverable_templates!.map(dt => (
                    <div key={dt.type} className="flex items-start gap-3 rounded-xl bg-gray-50 p-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-gray-800 capitalize">{dt.type.replace(/_/g,' ')}</span>
                          <span className="badge badge-gray text-[10px]">x{dt.quantity}</span>
                          {dt.due_date && <span className="text-xs text-gray-400">→ {dt.due_date}</span>}
                        </div>
                        {dt.description && <p className="mt-0.5 line-clamp-2 text-xs text-gray-500">{dt.description}</p>}
                      </div>
                    </div>
                  ))}
                </div> : <p className="text-sm text-gray-400">Aún no se han definido entregables.</p>}
              </div>
            )}

            {!isBrandPortal && (c as {visibility?: string}).visibility === 'open' && (
              <div className="card p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700">Notificar influencers</h3>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Envío manual a las siguientes 50 influencers con más seguidores que aún no fueron notificadas y tienen activado recibir campañas públicas por email.
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
          {!isBrandPortal && pendingApplications.length > 0
            && (!isBrandPortal || c._brand_permissions?.canEdit) && (
            <div className="card border-amber-200 bg-white shadow-sm">
              <button type="button" onClick={() => setPendingApplicationsOpen(open => !open)} className="flex w-full items-center justify-between gap-3 border-l-4 border-amber-400 bg-amber-50 px-4 py-3.5 text-left hover:bg-amber-100/80">
                <p className="flex items-center gap-2 text-base font-bold text-gray-900">
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                  {pendingApplications.length} solicitud(es) pendiente(s)
                </p>
                <ChevronDown className={cn('h-5 w-5 text-gray-600 transition-transform', pendingApplicationsOpen && 'rotate-180')} />
              </button>

              {pendingApplicationsOpen && <div className="border-t border-gray-200 p-4">

              {/* Filtros de postulantes — mismo estilo (select/input) que
                  InfluencerFilters.tsx, aplicados en memoria sobre esta lista.
                  Solo aparecen si hay algo que filtrar (>3 postulantes). */}
              <div className="mb-3 flex w-full min-w-0 flex-wrap items-center gap-2 overflow-visible pb-1">
                <div className="relative min-w-0 w-full sm:w-[300px] sm:shrink-0"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" /><input value={pendingSearch} onChange={event => setPendingSearch(event.target.value)} placeholder="Buscar nombre, Instagram o email" className="w-full rounded-lg border border-gray-300 bg-white py-2.5 pl-9 pr-8 text-sm text-gray-900 placeholder:text-gray-500 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100" />{pendingSearch && <button type="button" onClick={() => setPendingSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-800"><X className="h-4 w-4" /></button>}</div>
              {pendingApplications.length > 3 && (<>
                  <select
                    value={pendingTierFilter}
                    onChange={e => setPendingTierFilter(e.target.value as InfluencerTier | '')}
                    className="shrink-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
                  >
                    <option value="">Todos los seguidores</option>
                    <option value="nano">Nano (&lt;10K)</option>
                    <option value="micro">Micro (10K-100K)</option>
                    <option value="macro">Macro (100K-1M)</option>
                    <option value="mega">Mega (1M+)</option>
                  </select>

                  <select
                    value={pendingMinEngagement}
                    onChange={e => setPendingMinEngagement(Number(e.target.value))}
                    className="shrink-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
                  >
                    <option value={0}>Todo engagement</option>
                    <option value={1}>Engagement 1%+</option>
                    <option value={3}>Engagement 3%+</option>
                    <option value={5}>Engagement 5%+</option>
                  </select>

                  <select
                    value={pendingMinRating}
                    onChange={e => setPendingMinRating(Number(e.target.value))}
                    className="shrink-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
                  >
                    <option value={0}>Todo rating</option>
                    <option value={5}>Rating 5 estrellas</option>
                    <option value={4}>Rating 4+ estrellas</option>
                    <option value={3}>Rating 3+ estrellas</option>
                    <option value={2}>Rating 2+ estrellas</option>
                    <option value={1}>Rating 1+ estrella</option>
                  </select>

                  {pendingCommuneGroups.length > 0 && (
                    <select
                      value={pendingCommuneFilter}
                      onChange={e => setPendingCommuneFilter(e.target.value)}
                      className="shrink-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
                    >
                      <option value="">Todas las comunas</option>
                      {pendingCommuneGroups.map(c => (
                        <option key={c.label} value={c.variants.join(',')}>{c.label}</option>
                      ))}
                    </select>
                  )}

                  {pendingCategoryOptions.length > 0 && (
                    <select
                      value={pendingCategoryFilter}
                      onChange={e => setPendingCategoryFilter(e.target.value)}
                      className="shrink-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
                    >
                      <option value="">Todos los nichos</option>
                      {pendingCategoryOptions.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                    </select>
                  )}

                  {(pendingTierFilter || pendingCommuneFilter || pendingCategoryFilter || pendingMinEngagement > 0 || pendingMinRating > 0) && (
                    <button
                      type="button"
                      onClick={() => {
                        setPendingTierFilter('')
                        setPendingCommuneFilter('')
                        setPendingCategoryFilter('')
                        setPendingMinEngagement(0)
                        setPendingMinRating(0)
                      }}
                      className="text-sm font-semibold text-violet-700 hover:underline"
                    >
                      Limpiar filtros
                    </button>
                  )}

                  <span className="ml-auto shrink-0 text-sm font-medium text-gray-600">
                    Mostrando {filteredPendingApplications.length} de {pendingApplications.length}
                  </span>
              </>)}
                <div className="relative z-50 shrink-0"><ColumnVisibilityMenu columns={CI_COLUMNS} visible={pendingVisibleColumns} onToggle={togglePendingColumn} onReset={() => setPendingVisibleColumns(DEFAULT_CI_COLUMNS)} iconOnly /></div>
              </div>

              {filteredPendingApplications.length === 0 && (
                <p className="py-2 text-sm italic text-gray-600">
                  Ningún postulante coincide con estos filtros.
                </p>
              )}

              {filteredPendingApplications.length > 0 && (
                <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
                  <table className="w-full min-w-[900px]">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="bg-gray-50 px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-600">Influencer</th>
                        {pendingVisibleColumns.platform && <th className="bg-gray-50 px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-600">Plataforma</th>}
                        {pendingVisibleColumns.categories && <th className="bg-gray-50 px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-600">Categorías</th>}
                        {pendingVisibleColumns.followers && <th className="bg-gray-50 px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-600">Seguidores</th>}
                        {pendingVisibleColumns.engagement && <th className="bg-gray-50 px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-600">Engagement</th>}
                        {pendingVisibleColumns.rating && <th className="bg-gray-50 px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-600">Rating</th>}
                        {pendingVisibleColumns.commune && <th className="bg-gray-50 px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-600">Comuna</th>}
                        {pendingVisibleColumns.fee && <th className="bg-gray-50 px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-600">Fee</th>}
                        {pendingVisibleColumns.deliverables && <th className="bg-gray-50 px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-600">Deliverables</th>}
                        {pendingVisibleColumns.progress && <th className="bg-gray-50 px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-600">Progreso</th>}
                        {pendingVisibleColumns.status && <th className="bg-gray-50 px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-600">Estado</th>}
                        <th className="bg-gray-50 px-4 py-3 text-right text-xs font-bold uppercase tracking-wider text-gray-600">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredPendingApplications.map((ci, i) => {
                        const inf = ci.influencer
                        if (!inf) return null
                        const primarySP = inf.influencer_social_profiles?.[0]
                        const profileUrl = primarySP?.username ? buildProfileUrl(primarySP.platform, primarySP.username) : null
                        const gradient = GRADIENTS[i % GRADIENTS.length]
                        const initials = inf.display_name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()
                        const applicationsEndpoint = isBrandPortal
                          ? `/api/brand/campaigns/${id}/applications`
                          : `/api/campaigns/${id}/applications`
                        return (
                          <tr key={ci.id} className="transition-colors hover:bg-violet-50/40">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                {inf.avatar_url ? (
                                  <img src={inf.avatar_url} alt={inf.display_name} className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
                                ) : (
                                  <div className={cn('w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold bg-gradient-to-br flex-shrink-0', gradient)}>{initials}</div>
                                )}
                                <div className="min-w-0">
                                  <span className="text-sm font-semibold text-gray-900 whitespace-nowrap">{inf.display_name}</span>
                                  {primarySP?.username && (
                                    profileUrl ? <a href={profileUrl} target="_blank" rel="noopener noreferrer" className="block text-xs text-violet-600 hover:underline">@{primarySP.username}</a> : <div className="text-xs text-gray-400">@{primarySP.username}</div>
                                  )}
                                </div>
                              </div>
                            </td>
                            {pendingVisibleColumns.platform && <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">{primarySP ? `${PLATFORM_ICONS[primarySP.platform] ?? ''} ${primarySP.platform}` : '—'}</td>}
                            {pendingVisibleColumns.categories && <td className="px-4 py-3 text-sm text-gray-600">{inf.categories?.length ? inf.categories.join(', ') : '—'}</td>}
                            {pendingVisibleColumns.followers && <td className="px-4 py-3 text-sm font-semibold text-gray-700">{primarySP ? formatFollowers(primarySP.followers ?? 0) : '—'}</td>}
                            {pendingVisibleColumns.engagement && <td className="px-4 py-3 text-sm text-gray-500">{primarySP?.engagement_rate != null ? `${primarySP.engagement_rate.toFixed(2)}%` : '—'}</td>}
                            {pendingVisibleColumns.rating && <td className="px-4 py-3 text-sm font-semibold text-gray-700 whitespace-nowrap">{inf.rating != null ? <span className="inline-flex items-center gap-1"><Star className="h-4 w-4 fill-amber-400 text-amber-400" />{inf.rating.toFixed(1)}</span> : 'Sin rating'}</td>}
                            {pendingVisibleColumns.commune && <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">{inf.commune || inf.city || '—'}</td>}
                            {pendingVisibleColumns.fee && <td className="px-4 py-3 text-sm font-bold text-gray-900">{ci.fee ? formatCurrency(ci.fee, 'CLP') : '—'}</td>}
                            {pendingVisibleColumns.deliverables && <td className="px-4 py-3 text-sm text-gray-600">0/0</td>}
                            {pendingVisibleColumns.progress && <td className="px-4 py-3 text-sm text-gray-600">Sin deliverables</td>}
                            {pendingVisibleColumns.status && <td className="px-4 py-3"><span className="text-[11px] font-semibold rounded-full px-2 py-1 bg-amber-100 text-amber-700">Pendiente</span></td>}
                            <td className="px-4 py-3">
                              <div className="flex justify-end gap-2 whitespace-nowrap">
                                <button
                                  onClick={async () => {
                                    const response = await fetch(applicationsEndpoint, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ application_id: ci.id, action: 'accept' }) })
                                    if (response.ok) toast.success(`Postulación de ${inf.display_name} aceptada — se le notificó por email`)
                                    else toast.error('Error al aceptar la postulación')
                                    void refetch()
                                  }}
                                  className="text-xs font-bold bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700"
                                >Aceptar</button>
                                <button
                                  onClick={async () => {
                                    if (!confirm(`¿Rechazar la solicitud de ${inf.display_name}?`)) return
                                    const response = await fetch(applicationsEndpoint, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ application_id: ci.id, action: 'reject' }) })
                                    if (!response.ok) toast.error('Error al rechazar la postulación')
                                    void refetch()
                                  }}
                                  className="text-xs font-bold bg-white text-red-500 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-50"
                                >Rechazar</button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              </div>}
            </div>
          )}

          {/* Invitaciones pendientes (origin='invitation'): la influencer
              acepta/rechaza desde su portal. Admin puede retirarlas, incluso
              en campañas históricas/completadas; no se ofrece aceptar/rechazar
              porque la decisión corresponde a la influencer. */}
          {!isBrandPortal && pendingInvitations.length > 0
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
                        <span className="text-sm font-semibold text-gray-900">
                          {inf.display_name}
                        </span>
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
                      {!isBrandPortal && (
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm(`¿Quitar la invitación de ${inf.display_name}?`)) {
                              removeInfluencer.mutate(inf.id)
                            }
                          }}
                          disabled={removeInfluencer.isPending}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                          title="Quitar invitación"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <AttendanceConfirmationPanel
            campaignId={id}
            acceptedCount={confirmedInfluencers.length}
            deliverables={campaignDeliverables}
            defaultDueDate={attendanceSuggestedDueDate}
            canManage={!isBrandPortal || !!c._brand_permissions?.canEdit}
            onChanged={() => void refetch()}
          />
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-500">
              {(infFiltersActive || attendanceFilter !== 'all') ? `${attendanceFilteredInfluencers.length} de ${confirmedInfluencers.length}` : confirmedInfluencers.length} influencer{confirmedInfluencers.length !== 1 ? 's' : ''} asignado{confirmedInfluencers.length !== 1 ? 's' : ''}
            </p>
            <div className="flex items-center gap-2">
              {confirmedInfluencers.length > 0 && (!isBrandPortal || c._brand_permissions?.canEdit) && (
                <a href={`/api/campaigns/${id}/influencers/export`} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors">
                  <FileDown className="h-4 w-4" /> Excel
                </a>
              )}
              {pendingAttendanceInfluencerIds.length > 0 && (!isBrandPortal || c._brand_permissions?.canEdit) && (
                <button
                  onClick={() => void sendAttendanceReminders(Array.from(attendanceReminderSelection))}
                  disabled={!attendanceReminderSelection.size || attendanceReminderSending}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-violet-700 bg-violet-50 border border-violet-200 rounded-lg hover:bg-violet-100 transition-colors disabled:opacity-50"
                >
                  {attendanceReminderSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                  Enviar email ({attendanceReminderSelection.size})
                </button>
              )}
              {(!isBrandPortal || c._brand_permissions?.canEdit) && <Link href={isBrandPortal ? `/brand-campaigns/${id}/invite` : `/admin-campaigns/${id}/influencers/add`}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-white bg-violet-600 rounded-lg hover:bg-violet-700 transition-colors">
                + Agregar influencer
              </Link>}
            </div>
          </div>

          {confirmedInfluencers.length > 0 && (
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Buscar nombre, Instagram o email..."
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

              <div className="relative">
                <select value={attendanceFilter} onChange={e => setAttendanceFilter(e.target.value as typeof attendanceFilter)} className={cn('input-base appearance-none pr-8 cursor-pointer', attendanceFilter !== 'all' && 'border-violet-400 text-violet-700')}>
                  <option value="all">Toda la asistencia</option>
                  <option value="confirmed">Confirmaron</option>
                  <option value="declined">No podrán asistir</option>
                  <option value="no_show">No asistieron</option>
                  <option value="unconfirmed">No confirmaron</option>
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
              </div>

              <ColumnVisibilityMenu
                columns={CI_COLUMNS}
                visible={ciVisibleColumns}
                onToggle={toggleCiColumn}
                onReset={() => setCiVisibleColumns(DEFAULT_CI_COLUMNS)}
              />

              {(infFiltersActive || attendanceFilter !== 'all') && (
                <button
                  onClick={() => { setInfSearch(''); setInfPlatform(''); setInfStatus(''); setAttendanceFilter('all') }}
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
          ) : attendanceFilteredInfluencers.length === 0 ? (
            <div className="card p-12 text-center">
              <Search className="h-10 w-10 text-gray-200 mx-auto mb-3" />
              <p className="text-sm text-gray-400">No se encontraron influencers con esos filtros.</p>
            </div>
          ) : (
            <div className="block">
              <div className="card overflow-x-auto">
              <table className="w-full min-w-[640px]">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="px-3 py-3 text-left bg-gray-50 w-8">
                      {visiblePendingAttendanceInfluencerIds.length > 0 && (
                        <input
                          type="checkbox"
                          title="Seleccionar todas las asistentes pendientes"
                          className="w-3.5 h-3.5 accent-violet-600 cursor-pointer"
                          checked={visiblePendingAttendanceInfluencerIds.every(influencerId => attendanceReminderSelection.has(influencerId))}
                          onChange={(e) => {
                            setAttendanceReminderSelection(prev => {
                              const next = new Set(prev)
                              if (e.target.checked) visiblePendingAttendanceInfluencerIds.forEach(influencerId => next.add(influencerId))
                              else visiblePendingAttendanceInfluencerIds.forEach(influencerId => next.delete(influencerId))
                              return next
                            })
                          }}
                        />
                      )}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider bg-gray-50">Asistencia</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider bg-gray-50">Influencer</th>
                    {ciVisibleColumns.platform && (
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider bg-gray-50">Plataforma</th>
                    )}
                    {ciVisibleColumns.categories && (
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider bg-gray-50">Categorías</th>
                    )}
                    {ciVisibleColumns.followers && (
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider bg-gray-50">Seguidores</th>
                    )}
                    {ciVisibleColumns.engagement && (
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider bg-gray-50">Engagement</th>
                    )}
                    {ciVisibleColumns.commune && (
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider bg-gray-50">Comuna</th>
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
                  {attendanceFilteredInfluencers.map((ci, i) => {
                    const inf = ci.influencer
                    if (!inf) return null
                    const primarySP = inf.influencer_social_profiles?.[0]
                    const instagramSP = inf.influencer_social_profiles?.find(profile => profile.platform === 'instagram' && profile.username)
                    const instagramUrl = instagramSP?.username ? buildProfileUrl('instagram', instagramSP.username) : null
                    const myDelivs    = campaignDeliverables.filter(d => d.influencer?.id === inf.id)
                    const delivsDone  = myDelivs.filter(d => d.status === 'published').length
                    const delivsTotal = myDelivs.length
                    const myPending   = myDelivs.filter(d => !isDeliverableComplete(d)).length
                    const attendance = myDelivs.find(d => d.type === 'event_attendance')
                    const attendanceConfirmed = attendance?.attendance_response === 'confirmed'
                    const attendanceDeclined = attendance?.attendance_response === 'declined'
                    const attendancePending = !!attendance && !attendanceConfirmed && !attendanceDeclined
                    const noShow = attendance?.attendance_outcome === 'no_show'
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
                        className={cn(
                          'hover:bg-gray-50/70 transition-colors',
                          noShow && 'bg-gray-100 text-gray-400 opacity-70 grayscale'
                        )}
                      >
                        <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                          {attendancePending && (
                            <input
                              type="checkbox"
                              checked={attendanceReminderSelection.has(inf.id)}
                              onChange={event => setAttendanceReminderSelected(inf.id, event.target.checked)}
                              title="Seleccionar para enviar email de asistencia"
                              className="w-3.5 h-3.5 accent-violet-600 cursor-pointer"
                            />
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {noShow ? (
                            <span className="inline-flex rounded-full bg-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600">No asistió</span>
                          ) : attendanceConfirmed ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Confirmada</span>
                          ) : attendanceDeclined ? (
                            <span className="inline-flex rounded-full bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700">No asistirá</span>
                          ) : attendancePending ? (
                            <span className="inline-flex rounded-full bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700">Sin confirmar</span>
                          ) : (
                            <span className="text-xs text-gray-300">—</span>
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
                              <span className="text-left text-sm font-semibold text-gray-900">{inf.display_name}</span>
                              {instagramSP?.username && instagramUrl && (
                                <a href={instagramUrl} target="_blank" rel="noopener noreferrer" onClick={event => event.stopPropagation()} className="block text-xs text-violet-600 hover:underline">
                                  @{instagramSP.username}
                                </a>
                              )}
                            </div>
                          </div>
                        </td>
                        {ciVisibleColumns.platform && (
                          <td className="px-4 py-3 text-sm text-gray-500">
                            {primarySP ? (
                              <span className="flex items-center gap-1.5 capitalize whitespace-nowrap">
                                {PLATFORM_ICONS[primarySP.platform]}
                                <span className="font-medium">{primarySP.platform}</span>
                              </span>
                            ) : '—'}
                          </td>
                        )}
                        {ciVisibleColumns.categories && (
                          <td className="px-4 py-3 text-xs text-gray-500">{inf.categories?.length ? inf.categories.join(', ') : '—'}</td>
                        )}
                        {ciVisibleColumns.followers && (
                          <td className="px-4 py-3 text-sm font-semibold text-gray-700">{primarySP ? formatFollowers(primarySP.followers ?? 0) : '—'}</td>
                        )}
                        {ciVisibleColumns.engagement && (
                          <td className="px-4 py-3 text-sm text-gray-500">{primarySP?.engagement_rate != null ? `${primarySP.engagement_rate.toFixed(2)}%` : '—'}</td>
                        )}
                        {ciVisibleColumns.commune && (
                          <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">{inf.commune || inf.city || '—'}</td>
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

              <div className="hidden">
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
            // Contenido con URL y asistencias ya confirmadas. Las solicitudes
            // pendientes viven y se gestionan en el tab Influencers.
            const submittedDeliverables = campaignDeliverables.filter(
              deliverable => Boolean(
                deliverable.content_url ||
                deliverable.published_url ||
                (deliverable.type === 'event_attendance' && (deliverable.attendance_response === 'confirmed' || deliverable.attendance_outcome === 'no_show'))
              )
            )

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
                    collaboratorBrands={campaignBrands.filter(brand => brand._role === 'Colaboradora' && brand.id).map(brand => ({ id: String(brand.id), name: String(brand.name ?? 'Marca'), instagram: brand.instagram as string | null }))}
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
                      const ownWithMetrics = own.filter(d =>
                        d.performance != null && isEligibleCampaignResult(d) && (d.status === 'approved' || d.status === 'published')
                      )
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
                          attendanceReminder={g.items.some(d => d.type === 'event_attendance' && d.status === 'pending' && !d.attendance_response)
                            ? {
                              selected: attendanceReminderSelection.has(g.influencer.id),
                              sending: attendanceReminderSending,
                              onSelected: selected => setAttendanceReminderSelected(g.influencer.id, selected),
                              onSend: () => void sendAttendanceReminders([g.influencer.id]),
                            }
                            : undefined}
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
            <Link href={`/admin-campaigns/${id}?tab=overview&mode=edit`} className="text-sm font-semibold text-violet-600 hover:underline">
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
                <select
                  value={locationForm.location_type}
                  onChange={e => setLocationForm(prev => ({
                    ...prev,
                    location_type: e.target.value,
                    is_public: e.target.value === 'home' ? false : prev.is_public,
                  }))}
                  className="input-base w-full text-sm bg-white"
                >
                  <option value="store">Local o tienda</option>
                  <option value="event">Evento</option>
                  <option value="restaurant">Restaurante</option>
                  <option value="home">Casa de influencer</option>
                  <option value="virtual">Virtual</option>
                  <option value="other">Otro</option>
                </select>
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
                    disabled={locationForm.location_type === 'home'}
                    onChange={e => setLocationForm(prev => ({ ...prev, is_public: e.target.checked }))}
                  />
                  {locationForm.location_type === 'home'
                    ? 'Domicilio protegido (privado)'
                    : 'Visible para marca/influencer'}
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

          {(!isBrandPortal || c._brand_permissions?.canEdit) && <form onSubmit={handleAddCampaignAsset} className="space-y-3 rounded-xl border border-gray-100 bg-gray-50 p-4">
            <div className="flex gap-2">
              <button type="button" onClick={() => setAssetMode('file')} className={cn('px-3 py-1.5 rounded-lg text-xs font-semibold', assetMode === 'file' ? 'bg-violet-600 text-white' : 'bg-white text-gray-500 border')}>Subir archivo</button>
              <button type="button" onClick={() => setAssetMode('link')} className={cn('px-3 py-1.5 rounded-lg text-xs font-semibold', assetMode === 'link' ? 'bg-violet-600 text-white' : 'bg-white text-gray-500 border')}>Agregar enlace</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-[1fr_1.5fr_auto] gap-3 items-end">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Nombre</label>
              <input
                value={assetName}
                onChange={e => setAssetName(e.target.value)}
                className="input-base w-full text-sm"
                placeholder="Ej: Logo, brief, foto producto"
              />
            </div>
            {assetMode === 'file' ? <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Archivo</label>
              <input type="file" multiple={false} onChange={e => setAssetFile(e.target.files?.[0] ?? null)} className="input-base w-full text-sm bg-white" />
            </div> : <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">URL del asset</label>
              <input value={assetUrl} onChange={e => setAssetUrl(e.target.value)} className="input-base w-full text-sm" placeholder="https://..." />
            </div>}
            <button
              type="submit"
              disabled={assetSaving}
              className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-60"
            >
              {assetSaving ? 'Guardando...' : 'Agregar'}
            </button>
            </div>
          </form>}

          {campaignAssets.length === 0 ? (
            <p className="text-sm text-gray-400">Sin assets cargados para esta campaña.</p>
          ) : (
            <div className="space-y-3">
              {campaignAssets.map(asset => (
                <div key={String(asset.id)} className="flex items-center justify-between rounded-xl border border-gray-100 p-4 gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{String(asset.filename ?? 'Asset')}</p>
                    <p className="text-xs text-gray-400 truncate">{String(asset.mime_type ?? 'Enlace externo')}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <a
                      href={String(asset.signed_url ?? asset.storage_path)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-semibold text-violet-600 hover:underline inline-flex items-center gap-1"
                    >
                      Descargar <Download className="h-3 w-3" />
                    </a>
                    {(!isBrandPortal || c._brand_permissions?.canEdit) && <button
                      onClick={() => handleDeleteCampaignAsset(String(asset.id))}
                      className="text-xs font-semibold text-red-500 hover:underline"
                    >
                      Eliminar
                    </button>}
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
            <div className="flex items-center gap-3">
              {(!isBrandPortal || c._brand_permissions?.canEdit) && (
                <button type="button" onClick={() => setShowCampaignInvoiceModal(true)}
                  className="inline-flex items-center gap-2 px-3 py-2 bg-violet-600 text-white text-xs font-semibold rounded-lg hover:bg-violet-700">
                  <Plus className="h-4 w-4" /> Crear factura
                </button>
              )}
              <Link href={isBrandPortal ? '/brand-billing' : `/admin-billing?campaign_id=${id}`} className="text-sm font-semibold text-violet-600 hover:underline">
                Ver en billing
              </Link>
            </div>
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

      {showCampaignInvoiceModal && (
        <NewInvoiceModal
          onClose={() => setShowCampaignInvoiceModal(false)}
          initialCampaign={{ id, name: c.name }}
          initialClientName={String((c.brand as unknown as { name?: string } | null)?.name ?? '')}
          initialClientEmail={String((c.brand as unknown as { contact_email?: string } | null)?.contact_email ?? '')}
          lockCampaign
          onCreated={() => void reloadCampaignInvoices()}
        />
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
      {tab === 'barters' && (
        <BartersTab
          campaignId={id}
          campaignInfluencers={campaignInfluencers}
          campaignBenefits={c.campaign_benefits ?? []}
          onSaveBenefits={benefits => patchCampaign.mutateAsync({ campaign_benefits: benefits })}
        />
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
