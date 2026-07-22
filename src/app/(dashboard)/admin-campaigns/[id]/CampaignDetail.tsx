'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowLeft, Target, Calendar, DollarSign, Users, FileText,
  BarChart3, ExternalLink, CheckCircle2,
  XCircle, Clock, Pencil, Play, Pause, Check, AlertCircle, Loader2, Trash2, Plus, FileDown, Gift,
  ChevronRight, Search, X, ChevronDown, Star, Mail, Eye, Heart, MessageCircle, RefreshCw, MapPin, Upload, Download,
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
import { groupCommunes } from '@/lib/communes-chile'
import { toast } from 'sonner'
import { NewInvoiceModal } from '@/app/(dashboard)/admin-billing/BillingClient'
import { DeliverableTemplateBuilder, type DeliverableTemplate } from '@/components/campaigns/DeliverableTemplateBuilder'
import { BrandSelector } from '@/components/campaigns/BrandSelector'

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

// ── Columnas toggleables de la tabla del tab Influencers (mismo patrón que
// admin-brands/page.tsx: Influencer y Acciones quedan siempre fijas). ────────
type CiColumnKey = 'platform' | 'categories' | 'followers' | 'engagement' | 'commune' | 'fee' | 'deliverables' | 'progress' | 'status'
const CI_COLUMNS: Array<{ key: CiColumnKey; label: string }> = [
  { key: 'platform',     label: 'Plataforma' },
  { key: 'categories',   label: 'Categorías' },
  { key: 'followers',    label: 'Seguidores' },
  { key: 'engagement',   label: 'Engagement' },
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
