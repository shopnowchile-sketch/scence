'use client'

import { useEffect, useState, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  CheckCircle2,
  RefreshCw, Filter, Link2, ExternalLink, Upload, ChevronRight,
  Film, Layers, Video, Radio, FileText, Sparkles, CalendarCheck, MapPin, Send, Image as ImageIcon, ChevronDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { isDeliverableComplete } from '@/lib/deliverable-status'
import { toast } from 'sonner'

// ── Types ─────────────────────────────────────────────────────────────────────

type Deliverable = {
  id: string
  title: string | null
  description: string | null
  type: string
  platform: string | null
  due_date: string | null
  scheduled_at: string | null
  sequence_number: number | null
  status: string
  content_url: string | null
  published_url: string | null
  campaign_id: string
  campaign_name: string
  campaign_influencer_id: string
}

type CampaignGroup = {
  campaign_id: string
  campaign_name: string
  deliverables: Deliverable[]
}

// Criterio único de "completado" — ver src/lib/deliverable-status.ts.
const isCompleteDeliverable = isDeliverableComplete

// ── Helpers ───────────────────────────────────────────────────────────────────

const DELIVERABLE_STATUS: Record<string, { label: string; color: string }> = {
  pending:    { label: 'Pendiente',    color: 'bg-amber-100 text-amber-700' },
  in_review:  { label: 'En revisión', color: 'bg-blue-100 text-blue-700' },
  approved:   { label: 'Aprobado',    color: 'bg-green-100 text-green-700' },
  rejected:   { label: 'Rechazado',   color: 'bg-red-100 text-red-700' },
  published:  { label: 'Publicado',   color: 'bg-violet-100 text-violet-700' },
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatDateTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-CL', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function daysUntil(iso: string | null): string {
  if (!iso) return ''
  const diff = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000)
  if (diff < 0) return 'Vencida'
  if (diff === 0) return 'Hoy'
  if (diff === 1) return 'Mañana'
  return `${diff}d`
}

function urgencyColor(iso: string | null): string {
  if (!iso) return 'text-gray-400'
  const diff = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000)
  if (diff < 0) return 'text-red-600 font-semibold'
  if (diff <= 2) return 'text-red-500 font-semibold'
  if (diff <= 7) return 'text-amber-600'
  return 'text-gray-400'
}

// Ícono por tipo de entregable. `type` es texto libre (ver
// DeliverableTemplateBuilder.tsx / CampaignDetailView.influencer.tsx —
// valores mixtos: 'reel', 'post', 'Story', 'send_content', etc.), por eso
// se normaliza a minúsculas y se matchea por substring en vez de un enum
// cerrado. Fallback genérico para tipos no previstos.
function typeIcon(type: string) {
  const t = (type || '').toLowerCase()
  if (t.includes('reel'))                          return Film
  if (t.includes('stor'))                           return Layers
  if (t.includes('video'))                          return Video
  if (t.includes('live'))                           return Radio
  if (t.includes('blog'))                           return FileText
  if (t.includes('ugc'))                            return Sparkles
  if (t.includes('event_attendance'))               return CalendarCheck
  if (t.includes('checkin') || t.includes('event')) return MapPin
  if (t.includes('send_content') || t.includes('send')) return Send
  if (t.includes('post'))                           return ImageIcon
  return Link2
}

// Etiqueta corta por tipo — el campo `title` a veces trae el brief completo
// de la marca (varias líneas) en vez de un nombre corto ("Reel", "Story").
// Pedido: la fila de entregable debe verse simple (tipo + estado + fecha +
// botón), sin repetir el brief largo. El brief completo se sigue viendo al
// entrar a la campaña (CollapsibleBrief), acá no se pierde información.
function typeLabel(type: string): string {
  const t = (type || '').toLowerCase()
  if (t.includes('reel'))                          return 'Reel'
  if (t.includes('stor'))                           return 'Story'
  if (t.includes('video'))                          return 'Video'
  if (t.includes('live'))                           return 'Live'
  if (t.includes('blog'))                           return 'Blog'
  if (t.includes('ugc'))                            return 'UGC'
  if (t.includes('event_attendance'))               return 'Asistencia a evento'
  if (t.includes('checkin') || t.includes('event')) return 'Check-in'
  if (t.includes('send_content') || t.includes('send')) return 'Envío de contenido'
  if (t.includes('post'))                           return 'Post'
  return type || 'Entregable'
}

// ── Deliverable row (reel link + submit) ─────────────────────────────────────

function DeliverableRow({ d, onUpdate, showCampaignLink = false }: { d: Deliverable; onUpdate: () => void; showCampaignLink?: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState(d.content_url ?? '')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const cfg = DELIVERABLE_STATUS[d.status] ?? { label: d.status, color: 'bg-gray-100 text-gray-500' }
  const canSubmit = d.status === 'pending' || d.status === 'rejected'
  const isDone = d.status === 'approved' || d.status === 'published'

  async function submit() {
    if (!url) { toast.error('Agrega el link del contenido'); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/influencer/deliverables/${d.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content_url: url, notes: notes || null }),
      })
      if (!res.ok) throw new Error()
      toast.success('Entregable enviado para revisión')
      setOpen(false)
      onUpdate()
    } catch {
      toast.error('Error al enviar. Intenta de nuevo.')
    }
    setSaving(false)
  }

  const TypeIcon = typeIcon(d.type)
  // Avatar de tipo, coloreado por estado — da jerarquía visual (qué es el
  // entregable) sin perder la señal de estado (ya cubierta por cfg.label
  // más abajo, esto solo la refuerza con color).
  const avatarCls = isDone
    ? 'bg-green-50 text-green-500'
    : d.status === 'in_review'
    ? 'bg-blue-50 text-blue-500'
    : d.status === 'rejected'
    ? 'bg-red-50 text-red-500'
    : 'bg-amber-50 text-amber-500'

  return (
    <div className={cn('border rounded-xl p-3.5 space-y-2', isDone ? 'border-green-100 bg-green-50/30' : 'border-gray-100 bg-white')}>
      <div className="flex items-start gap-3">
        {/* Ícono por tipo de entregable, coloreado por estado */}
        <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0', avatarCls)}>
          <TypeIcon className="h-4 w-4" />
        </div>

        <div className="flex-1 min-w-0">
          {/* Campaign badge — solo en vistas donde no hay un header de
              campaña ya visible arriba. En la vista de Entregables el link a la
              campaña ya vive en el header del grupo, así que no se repite. */}
          {showCampaignLink && (
            <button
              onClick={() => router.push(`/inf-campaign/${d.campaign_id}`)}
              className="text-[10px] font-semibold text-violet-600 hover:text-violet-700 hover:underline flex items-center gap-0.5 mb-1"
            >
              {d.campaign_name} <ChevronRight className="h-2.5 w-2.5" />
            </button>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn('text-sm font-semibold truncate', isDone ? 'text-gray-400 line-through' : 'text-gray-900')}>
              {typeLabel(d.type)}{d.sequence_number ? ` ${d.sequence_number}` : ''}
            </span>
            <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full', cfg.color)}>{cfg.label}</span>
            {d.platform && <span className="text-[10px] text-gray-400 capitalize">{d.platform}</span>}
          </div>

          {d.description && (
            <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{d.description}</p>
          )}

          {d.due_date && !isDone && (
            <div className="flex items-center gap-1.5 mt-1">
              <span className="text-[10px] text-gray-300">Vence:</span>
              <span className={cn('text-[10px] font-medium', urgencyColor(d.due_date))}>
                {daysUntil(d.due_date)} · {formatDate(d.due_date)}
              </span>
            </div>
          )}

          {d.scheduled_at && !isDone && (
            <p className="text-[10px] font-medium text-violet-600 mt-1">
              Publicar: {formatDateTime(d.scheduled_at)}
            </p>
          )}

          {/* Existing content url */}
          {d.content_url && !open && (
            <a href={d.content_url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-violet-600 hover:underline mt-1">
              <Link2 className="h-3 w-3" /> Ver contenido
            </a>
          )}
        </div>

        {/* Action button */}
        <div className="flex-shrink-0">
          {canSubmit && (
            <button
              onClick={() => setOpen(v => !v)}
              className="flex items-center gap-1.5 text-sm font-bold text-white bg-violet-600 hover:bg-violet-700 px-4 py-2.5 rounded-xl transition-colors shadow-sm"
            >
              <Upload className="h-4 w-4" />
              {d.status === 'rejected' ? 'Reenviar' : d.content_url ? 'Actualizar' : 'Subir'}
            </button>
          )}
          {d.status === 'in_review' && (
            <span className="text-[10px] text-blue-500 font-medium">En revisión</span>
          )}
        </div>
      </div>

      {/* Submit form */}
      {open && (
        <div className="space-y-2 pt-2 border-t border-gray-100">
          <div>
            <label className="text-[10px] font-semibold text-gray-400 uppercase">Link del reel / contenido</label>
            <div className="flex gap-2 mt-1">
              <input
                type="url"
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="https://www.instagram.com/reel/…"
                className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-violet-400"
              />
              {url && (
                <a href={url} target="_blank" rel="noopener noreferrer"
                  className="p-2 text-gray-400 hover:text-violet-600 border border-gray-200 rounded-lg">
                  <ExternalLink className="h-4 w-4" />
                </a>
              )}
            </div>
          </div>
          <input
            type="text"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Notas para el equipo (opcional)"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-violet-400"
          />
          <div className="flex gap-2">
            <button onClick={() => setOpen(false)} className="flex-1 py-2 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50">
              Cancelar
            </button>
            <button
              onClick={submit}
              disabled={saving || !url}
              className="flex-1 py-2 text-sm font-semibold bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50"
            >
              {saving ? 'Enviando…' : 'Enviar para revisión'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

// Wrapper con Suspense: useSearchParams() lo exige en build de producción
// (mismo problema ya visto antes en el layout de marca — sin Suspense, el
// build de Next rompía). El deep-link "?campaign=id" (usado desde
// /inf-campaigns e inf-dash para ir directo a los entregables de una
// campaña) se lee dentro de la página.
export default function DeliverablesPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-10 h-10 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
      </div>
    }>
      <DeliverablesPageInner />
    </Suspense>
  )
}

function DeliverablesPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const focusCampaignId = searchParams.get('campaign')
  const [deliverables, setDeliverables] = useState<Deliverable[]>([])
  const [loading,      setLoading]      = useState(true)
  const [delivFilter,  setDelivFilter]  = useState<'all' | 'pending' | 'done'>('all')
  const [expandedCampaigns, setExpandedCampaigns] = useState<Set<string>>(
    () => new Set(focusCampaignId ? [focusCampaignId] : [])
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const campRes = await fetch('/api/influencer/campaigns')
      const campData = await campRes.json()

      // Build deliverables from campaign_influencers
      // Postulación pendiente de aprobación → no debe mostrar entregables
      // acá todavía (recién se crean/habilitan cuando se acepta).
      const delivs: Deliverable[] = []
      for (const ci of (campData.data ?? [])) {
        if (ci.application_status === 'pending') continue
        const c = ci.campaign
        if (!c) continue
        for (const d of (ci.campaign_deliverables ?? [])) {
          delivs.push({
            id: d.id,
            title: d.title,
            description: d.description ?? null,
            type: d.type,
            platform: d.platform,
            due_date: d.due_date,
            scheduled_at: d.scheduled_at ?? null,
            sequence_number: d.sequence_number ?? null,
            status: d.status,
            content_url: d.content_url ?? null,
            published_url: d.published_url ?? null,
            campaign_id: c.id,
            campaign_name: c.name,
            campaign_influencer_id: ci.id,
          })
        }
      }
      // Sort: pending first, then by due_date
      delivs.sort((a, b) => {
        const order = ['pending', 'rejected', 'in_review', 'approved', 'published']
        const ai = order.indexOf(a.status)
        const bi = order.indexOf(b.status)
        if (ai !== bi) return ai - bi
        if (!a.due_date) return 1
        if (!b.due_date) return -1
        return new Date(a.due_date).getTime() - new Date(b.due_date).getTime()
      })
      setDeliverables(delivs)
    } catch {
      toast.error('Error cargando entregables')
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Deep-link "?campaign=id" — hace scroll a la campaña apuntada una vez
  // que ya está renderizada (recién cargados los datos).
  useEffect(() => {
    if (!focusCampaignId || loading) return
    const el = document.getElementById(`campaign-group-${focusCampaignId}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [focusCampaignId, loading])

  const pendingDeliverables = deliverables.filter(d => !isCompleteDeliverable(d))

  // Agrupar por campaña — `deliverables` ya viene ordenado (pendientes
  // primero), así que el orden de aparición de los grupos respeta esa
  // prioridad sin necesidad de un sort adicional.
  const campaignGroups: CampaignGroup[] = []
  const groupIndex = new Map<string, number>()
  for (const d of deliverables) {
    if (!groupIndex.has(d.campaign_id)) {
      groupIndex.set(d.campaign_id, campaignGroups.length)
      campaignGroups.push({ campaign_id: d.campaign_id, campaign_name: d.campaign_name, deliverables: [] })
    }
    campaignGroups[groupIndex.get(d.campaign_id)!].deliverables.push(d)
  }

  // Filtro pendientes/completados para Entregables. El % / conteo del header de cada
  // campaña sigue reflejando el total real del grupo (sin filtrar); el
  // filtro solo decide qué filas de entregable se listan al expandir, y
  // oculta grupos que se quedan sin filas tras filtrar.
  function matchesDelivFilter(d: Deliverable) {
    if (delivFilter === 'all') return true
    return delivFilter === 'done' ? isCompleteDeliverable(d) : !isCompleteDeliverable(d)
  }
  const visibleCampaignGroups = campaignGroups.filter(g => g.deliverables.some(matchesDelivFilter))

  function toggleCampaign(id: string) {
    setExpandedCampaigns(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-gray-400">Cargando entregables…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Mis entregables</h1>
          <p className="text-sm text-gray-400 mt-0.5">{pendingDeliverables.length} entregables pendientes</p>
        </div>
        <button onClick={load} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {/* ── DELIVERABLES TAB — agrupado por campaña ── */}
      <div className="space-y-3">
          {/* Filtro pendientes/completados */}
          {campaignGroups.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <Filter className="h-4 w-4 text-gray-300 flex-shrink-0" />
              {([
                { key: 'all',     label: 'Todos' },
                { key: 'pending', label: 'Pendientes' },
                { key: 'done',    label: 'Completados' },
              ] as { key: typeof delivFilter; label: string }[]).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setDelivFilter(key)}
                  className={cn(
                    'text-xs font-medium px-3 py-1.5 rounded-full border transition-colors',
                    delivFilter === key
                      ? 'bg-violet-600 text-white border-violet-600'
                      : 'bg-white text-gray-500 border-gray-200 hover:border-violet-200'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {visibleCampaignGroups.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-100 flex flex-col items-center py-10">
              <CheckCircle2 className="h-8 w-8 text-gray-200 mb-2" />
              <p className="text-sm text-gray-400">
                {delivFilter === 'all' ? '¡Todo al día con los entregables!' : 'No hay entregables en este filtro.'}
              </p>
            </div>
          ) : visibleCampaignGroups.map(g => {
            const total    = g.deliverables.length
            const doneCt   = g.deliverables.filter(isCompleteDeliverable).length
            const pending  = g.deliverables.filter(d => !isCompleteDeliverable(d))
            const pct      = total > 0 ? Math.round((doneCt / total) * 100) : 0
            const nextDue  = pending.map(d => d.due_date).filter(Boolean).sort()[0] ?? null
            const typeCounts = new Map<string, number>()
            for (const d of g.deliverables) typeCounts.set(d.type, (typeCounts.get(d.type) ?? 0) + 1)
            const summary = Array.from(typeCounts.entries()).map(([t, n]) => `${n} ${typeLabel(t)}`).join(' · ')
            const expanded = expandedCampaigns.has(g.campaign_id)

            return (
              <div key={g.campaign_id} id={`campaign-group-${g.campaign_id}`} className="bg-white rounded-2xl border border-gray-100 overflow-hidden scroll-mt-4">
                <div className="w-full text-left p-4">
                  <div className="flex items-center justify-between gap-3">
                    {/* Único link a la campaña de todo el grupo — lleva al
                        detalle. Separado del toggle de abajo para no mezclar
                        "ver campaña" con "expandir/colapsar". */}
                    <button
                      onClick={() => router.push(`/inf-campaign/${g.campaign_id}`)}
                      className="text-base font-bold text-violet-600 truncate text-left hover:text-violet-700 hover:underline min-w-0"
                    >
                      {g.campaign_name}
                    </button>
                    {/* % completado, grande y a la derecha — sube apenas la
                        influencer manda el link del entregable. */}
                    <span className={cn('text-2xl font-bold flex-shrink-0', pct === 100 ? 'text-green-500' : 'text-gray-900')}>
                      {pct}%
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => toggleCampaign(g.campaign_id)}
                    aria-expanded={expanded}
                    aria-controls={`campaign-deliverables-${g.campaign_id}`}
                    className="w-full text-left mt-2 rounded-xl p-2 -m-2 hover:bg-violet-50/60 transition-colors"
                  >
                    {summary && <p className="text-xs text-gray-400 mt-0.5 truncate">{summary}</p>}

                    <div className="flex items-center gap-4 mt-2 flex-wrap">
                      {nextDue && (
                        <span className={cn('text-[11px] font-medium', urgencyColor(nextDue))}>
                          Próxima entrega: {daysUntil(nextDue)} · {formatDate(nextDue)}
                        </span>
                      )}
                      <span className="text-[11px] text-gray-400">{pending.length} pendiente{pending.length !== 1 ? 's' : ''}</span>
                    </div>

                    <div className="flex items-center gap-2 mt-2">
                      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className={cn('h-full rounded-full', pct === 100 ? 'bg-green-500' : 'bg-violet-500')} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs font-semibold text-violet-600 whitespace-nowrap">
                        {expanded ? 'Ocultar entregables' : `Ver ${total} entregable${total !== 1 ? 's' : ''}`}
                      </span>
                      <span className="w-9 h-9 rounded-full bg-violet-600 shadow-sm flex items-center justify-center flex-shrink-0">
                        <ChevronDown className={cn('h-5 w-5 text-white transition-transform duration-200', expanded && 'rotate-180')} />
                      </span>
                    </div>
                  </button>
                </div>

                {expanded && (
                  <div id={`campaign-deliverables-${g.campaign_id}`} className="px-4 pb-4 space-y-2 border-t border-gray-50 pt-3">
                    {g.deliverables.filter(matchesDelivFilter).map(d => <DeliverableRow key={d.id} d={d} onUpdate={load} />)}
                  </div>
                )}
              </div>
            )
          })}
      </div>
    </div>
  )
}
