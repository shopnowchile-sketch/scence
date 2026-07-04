'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Building2, FileText, Circle, CheckCircle2, XCircle,
  Clock, ExternalLink, Download, RefreshCw, Upload,
  Plus, X, Loader2, AlertCircle, ChevronDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { fmtDate, fmtMoney, DELIVERABLE_STATUS, CAMPAIGN_STATUS } from '@/lib/campaign-utils'
import { BartersReadonly } from '@/components/campaigns/BartersReadonly'

// ── Types ─────────────────────────────────────────────────────────────────────
type Deliverable = {
  id: string; title: string | null; type: string; platform: string | null
  due_date: string | null; status: string; content_url: string | null; notes: string | null
  // Campos reales de campaign_deliverables (ya existían en la tabla, no se inventan);
  // agregados al select de /api/influencer/my-campaigns para mostrar
  // descripción/requisitos en el acordeón mobile solo cuando existen.
  description?: string | null
  hashtags?: string[] | null
}

type CampaignRow = {
  id: string | null; status: string; application_status?: string | null; fee: number | null; currency: string
  _self_created?: boolean
  // FIX (2026-07-02): campaign_deliverables viene del backend como sibling de
  // `campaign` (join separado sobre campaign_influencer_id), no anidado dentro
  // de `campaign` — /api/influencer/my-campaigns siempre lo devuelve así, para
  // asignadas Y para self-created. Antes el tipo lo declaraba anidado y
  // `c.campaign_deliverables.filter(...)` tiraba "Cannot read properties of
  // undefined" en TODA campaña asignada (bug real, encontrado por Pri en UAT).
  campaign_deliverables: Deliverable[]
  campaign: {
    id: string; name: string; status: string
    description: string | null; brief: string | null
    start_date: string | null; end_date: string | null
    currency: string
    brand: { id: string; name: string; logo_url: string | null; website: string | null } | null
  } | null
}

// Preview de campaña open aún no postulada (GET /api/influencer/campaigns/[id])
type PreviewCampaign = {
  id: string; name: string; status: string; visibility: string
  description: string | null; content_guidelines: string | null
  start_date: string | null; end_date: string | null
  budget_total: number | null; currency: string
  hashtags: string[] | null; platforms: string[] | null
  deliverable_templates: Array<{ type: string; quantity?: number; description?: string }> | null
  application_deadline: string | null
  brand: { id: string; name: string; logo_url: string | null; website: string | null } | null
  _applied: boolean
  application_status: string | null
}

// ── Deliverable accordion (mobile-first) ──────────────────────────────────────
function statusIcon(status: string) {
  if (status === 'approved' || status === 'published') return <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
  if (status === 'in_review') return <Clock className="h-4 w-4 text-blue-500 flex-shrink-0" />
  if (status === 'rejected') return <XCircle className="h-4 w-4 text-red-400 flex-shrink-0" />
  return <Circle className="h-4 w-4 text-amber-400 flex-shrink-0" />
}

function DeliverableRow({ d, onUpdate }: { d: Deliverable; onUpdate: () => void }) {
  const [open,   setOpen]   = useState(false)
  const [url,    setUrl]    = useState(d.content_url ?? '')
  const [notes,  setNotes]  = useState('')
  const [saving, setSaving] = useState(false)
  const cfg       = DELIVERABLE_STATUS[d.status as keyof typeof DELIVERABLE_STATUS] ?? DELIVERABLE_STATUS.pending
  const canSubmit = d.status === 'pending' || d.status === 'rejected'
  const hasExtra  = !!(d.description?.trim() || d.platform || (d.hashtags && d.hashtags.length > 0))

  async function submit() {
    setSaving(true)
    try {
      const res = await fetch(`/api/influencer/deliverables/${d.id}/submit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content_url: url || null, notes: notes || null }),
      })
      if (!res.ok) throw new Error()
      toast.success('Entregable enviado para revisión')
      onUpdate()
    } catch { toast.error('Error al enviar. Intenta de nuevo.') }
    setSaving(false)
  }

  return (
    <div className={cn('bg-white rounded-2xl border overflow-hidden', canSubmit ? 'border-violet-100' : 'border-gray-100')}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
      >
        {statusIcon(d.status)}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{d.title || d.type}</p>
          {d.due_date && (
            <p className={cn('text-[11px] mt-0.5', canSubmit ? 'text-amber-600' : 'text-gray-400')}>
              Vence {fmtDate(d.due_date)}
            </p>
          )}
        </div>
        {canSubmit && (
          <span className="text-xs font-semibold text-violet-600 flex-shrink-0">
            {d.status === 'rejected' ? 'Reenviar' : 'Subir'}
          </span>
        )}
        {!canSubmit && (
          <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0', cfg.color)}>{cfg.label}</span>
        )}
        <ChevronDown className={cn('h-4 w-4 text-gray-300 flex-shrink-0 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-gray-50 space-y-3">
          {d.description?.trim() && (
            <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line">{d.description}</p>
          )}

          {(d.platform || (d.hashtags && d.hashtags.length > 0)) && (
            <div className="flex flex-wrap gap-1.5">
              {d.platform && (
                <span className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-violet-50 text-violet-600 capitalize">{d.platform}</span>
              )}
              {(d.hashtags ?? []).map(h => (
                <span key={h} className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-gray-100 text-gray-500">#{h.replace(/^#/, '')}</span>
              ))}
            </div>
          )}

          {d.content_url && (
            <a href={d.content_url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-violet-600 hover:underline">
              <ExternalLink className="h-3 w-3" /> Ver contenido enviado
            </a>
          )}

          {!hasExtra && !d.content_url && !canSubmit && (
            <p className="text-xs text-gray-400">Sin más detalles para este entregable.</p>
          )}

          {canSubmit && (
            <div className="space-y-2 pt-1">
              <input type="url" value={url} onChange={e => setUrl(e.target.value)}
                placeholder="Link del contenido (Instagram, YouTube, Drive…)"
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 outline-none focus:border-violet-400" />
              <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="Notas para el equipo (opcional)"
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 outline-none focus:border-violet-400" />
              <button onClick={submit} disabled={saving || !url}
                className="w-full flex items-center justify-center gap-2 py-3.5 text-sm font-semibold bg-violet-600 text-white rounded-xl hover:bg-violet-700 disabled:opacity-50 transition-colors">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {saving ? 'Enviando…' : 'Subir link'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Add deliverable (self-created campaigns) ──────────────────────────────────
const PLATFORMS = ['Instagram', 'TikTok', 'YouTube', 'Twitter', 'Facebook', 'LinkedIn', 'Otro']
const DEL_TYPES = ['Reel', 'Post', 'Story', 'Video', 'Blog', 'Live', 'UGC', 'Otro']

function AddDeliverableForm({ campaignId, onAdded }: { campaignId: string; onAdded: () => void }) {
  const [open,   setOpen]   = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ title: '', type: 'Reel', platform: 'Instagram', due_date: '' })

  async function save() {
    if (!form.title.trim()) return
    setSaving(true)
    try {
      const res = await fetch('/api/influencer/my-campaigns', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: campaignId,
          deliverables: [{ title: form.title, type: form.type, platform: form.platform, due_date: form.due_date || null, status: 'pending' }],
        }),
      })
      if (!res.ok) throw new Error()
      toast.success('Entregable agregado')
      setOpen(false)
      setForm({ title: '', type: 'Reel', platform: 'Instagram', due_date: '' })
      onAdded()
    } catch { toast.error('Error al agregar entregable') }
    setSaving(false)
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-5 py-4 hover:bg-gray-50 transition-colors">
        {open ? <X className="h-4 w-4 text-gray-400" /> : <Plus className="h-4 w-4 text-violet-600" />}
        <span className="text-sm font-semibold text-gray-700">Agregar entregable</span>
      </button>
      {open && (
        <div className="border-t border-gray-50 p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-gray-500 mb-1">Título *</label>
              <input type="text" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Reel producto X" className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 outline-none focus:border-violet-400 bg-gray-50" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Tipo</label>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 bg-gray-50 outline-none focus:border-violet-400">
                {DEL_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Plataforma</label>
              <select value={form.platform} onChange={e => setForm(f => ({ ...f, platform: e.target.value }))}
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 bg-gray-50 outline-none focus:border-violet-400">
                {PLATFORMS.map(p => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-gray-500 mb-1">Fecha vencimiento</label>
              <input type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))}
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 bg-gray-50 outline-none focus:border-violet-400" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setOpen(false)} className="flex-1 py-2 text-sm text-gray-500 border border-gray-200 rounded-xl hover:bg-gray-50">Cancelar</button>
            <button onClick={save} disabled={saving || !form.title.trim()}
              className="flex-1 py-2 text-sm font-semibold bg-violet-600 text-white rounded-xl hover:bg-violet-700 disabled:opacity-50 flex items-center justify-center gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {saving ? 'Guardando…' : 'Agregar'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Brief colapsado (mobile-first, cerrado por defecto) ───────────────────────
function CollapsibleBrief({ text, guidelines }: { text: string | null; guidelines?: string | null }) {
  const [open, setOpen] = useState(false)
  if (!text?.trim() && !guidelines?.trim()) return null
  return (
    <div className="pt-3 mt-3 border-t border-gray-50">
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center gap-2 text-left">
        <FileText className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
        <span className="text-xs font-medium text-gray-500 flex-1">Ver brief de la campaña</span>
        <ChevronDown className={cn('h-3.5 w-3.5 text-gray-300 flex-shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          {text?.trim() && <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line">{text}</p>}
          {guidelines?.trim() && (
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-xs font-semibold text-gray-500 mb-1">Lineamientos de contenido</p>
              <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line">{guidelines}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Resumen de entregables (conteos) ──────────────────────────────────────────
function DeliverablesSummary({ deliverables }: { deliverables: Deliverable[] }) {
  const pending   = deliverables.filter(d => d.status === 'pending').length
  const inReview  = deliverables.filter(d => d.status === 'in_review').length
  const approved  = deliverables.filter(d => d.status === 'approved' || d.status === 'published').length
  const rejected  = deliverables.filter(d => d.status === 'rejected').length

  const items = [
    { key: 'pending',  label: 'pendientes',  count: pending,  bg: 'bg-amber-50',  text: 'text-amber-700' },
    { key: 'inReview', label: 'en revisión', count: inReview, bg: 'bg-blue-50',   text: 'text-blue-700',  show: inReview > 0 },
    { key: 'approved', label: 'aprobados',   count: approved, bg: 'bg-green-50',  text: 'text-green-700' },
    { key: 'rejected', label: 'rechazados',  count: rejected, bg: 'bg-red-50',    text: 'text-red-600',   show: rejected > 0 },
  ].filter(i => i.show !== false)

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
      {items.map(i => (
        <div key={i.key} className={cn('rounded-xl px-3 py-2.5', i.bg)}>
          <p className={cn('text-xl font-bold leading-none', i.text)}>{i.count}</p>
          <p className={cn('text-[11px] mt-0.5', i.text)}>{i.label}</p>
        </div>
      ))}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export function InfluencerCampaignView({ id }: { id: string }) {
  const router = useRouter()
  const [data,    setData]    = useState<CampaignRow | null>(null)
  const [preview, setPreview] = useState<PreviewCampaign | null>(null)
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch('/api/influencer/my-campaigns')
      const json = await res.json()
      const found = (json.data ?? []).find((ci: CampaignRow) => ci.campaign?.id === id || ci.id === id)
      if (found) {
        setData(found)
        setPreview(null)
      } else {
        // No está entre mis campañas todavía — puede ser una campaña abierta
        // que aún no postula. Traer preview de solo-lectura.
        setData(null)
        const pRes = await fetch(`/api/influencer/campaigns/${id}`)
        setPreview(pRes.ok ? (await pRes.json()).data : null)
      }
    } catch { toast.error('Error cargando campaña') }
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  async function handleApply() {
    if (!preview) return
    if (!confirm(`¿Enviar solicitud para unirte a "${preview.name}"? El equipo la revisará y te confirmará.`)) return
    setApplying(true)
    try {
      const res  = await fetch(`/api/influencer/campaigns/${id}/apply`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('¡Solicitud enviada! El equipo te confirmará pronto.')
      setPreview(p => p ? { ...p, _applied: true, application_status: 'pending' } : p)
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error al enviar solicitud')
    }
    setApplying(false)
  }

  if (loading) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="w-10 h-10 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
    </div>
  )

  if (!data?.campaign && preview) {
    const p = preview
    const templates = p.deliverable_templates ?? []
    const pStatus = CAMPAIGN_STATUS[p.status] ?? { label: 'Abierta', color: 'bg-green-100 text-green-700' }
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="text-lg font-bold text-gray-900 truncate flex-1">Campaña abierta</h1>
        </div>

        {/* Card combinada: nombre, marca, badge, fechas, brief colapsado */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <div className="flex items-start gap-3 mb-3">
            {p.brand?.logo_url
              ? <img src={p.brand.logo_url} alt={p.brand.name} className="w-11 h-11 rounded-xl object-contain border border-gray-100 flex-shrink-0" />
              : <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-100 to-pink-100 flex items-center justify-center flex-shrink-0">
                  <Building2 className="h-5 w-5 text-violet-400" />
                </div>}
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-bold text-gray-900 leading-snug">{p.name}</h2>
              {p.brand && <p className="text-sm text-gray-400 mt-0.5">{p.brand.name}</p>}
            </div>
            <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0', pStatus.color)}>{pStatus.label}</span>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-3 border-t border-gray-50">
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Inicio</p>
              <p className="text-sm font-bold text-gray-900 mt-0.5">{fmtDate(p.start_date)}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Termina</p>
              <p className="text-sm font-bold text-gray-900 mt-0.5">{fmtDate(p.end_date)}</p>
            </div>
          </div>

          <CollapsibleBrief text={p.description} guidelines={p.content_guidelines} />
        </div>

        {templates.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <h2 className="text-sm font-bold text-gray-900 mb-3">Deliverables requeridos</h2>
            <div className="space-y-2">
              {templates.map((t, i) => (
                <div key={i} className="flex items-center gap-2 text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2">
                  <Circle className="h-3 w-3 text-gray-300 flex-shrink-0" />
                  {t.quantity ?? 1}× {t.description || t.type}
                </div>
              ))}
            </div>
          </div>
        )}

        {((p.platforms?.length ?? 0) > 0 || (p.hashtags?.length ?? 0) > 0) && (
          <div className="bg-white rounded-2xl border border-gray-100 p-5 flex flex-wrap gap-2">
            {(p.platforms ?? []).map(pl => (
              <span key={pl} className="text-xs font-semibold px-2.5 py-1 rounded-full bg-violet-50 text-violet-600 capitalize">{pl}</span>
            ))}
            {(p.hashtags ?? []).map(h => (
              <span key={h} className="text-xs font-medium px-2.5 py-1 rounded-full bg-gray-100 text-gray-500">#{h.replace(/^#/, '')}</span>
            ))}
          </div>
        )}

        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          {p._applied ? (
            <div className="flex items-center gap-2 text-sm font-semibold text-green-600">
              <CheckCircle2 className="h-4 w-4" />
              {p.application_status === 'pending'
                ? 'Solicitud enviada — te avisaremos apenas la revisemos.'
                : 'Ya estás vinculada a esta campaña.'}
            </div>
          ) : (
            <button onClick={handleApply} disabled={applying}
              className="w-full py-3.5 text-sm font-bold bg-violet-600 text-white rounded-xl hover:bg-violet-700 disabled:opacity-50 transition-colors">
              {applying ? 'Enviando…' : 'Postular a esta campaña'}
            </button>
          )}
        </div>
      </div>
    )
  }

  if (!data?.campaign) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
      <AlertCircle className="h-10 w-10 text-gray-300" />
      <p className="text-sm text-gray-400">Campaña no encontrada.</p>
      <button onClick={() => router.back()} className="text-sm text-violet-600 hover:underline">Volver</button>
    </div>
  )

  const c            = data.campaign
  const isSelfCreated = data._self_created === true
  const isPending    = data.application_status === 'pending'
  const campStatus   = CAMPAIGN_STATUS[c.status] ?? CAMPAIGN_STATUS.draft
  const deliverables = data.campaign_deliverables ?? []
  // Orden: lo que necesita acción primero (pendiente/rechazado), luego en
  // revisión, luego aprobado/publicado — mismos estados que ya existían,
  // solo se unifica en una sola lista de acordeones en vez de 2 cards separadas.
  const order = (s: string) => (s === 'pending' || s === 'rejected') ? 0 : s === 'in_review' ? 1 : 2
  const sortedDeliverables = [...deliverables].sort((a, b) => order(a.status) - order(b.status))

  return (
    <div className="space-y-5">
      {/* Postulación en revisión — aún no hay deliverables asignados */}
      {isPending && (
        <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 flex items-center gap-3">
          <Clock className="h-5 w-5 text-amber-500 flex-shrink-0" />
          <p className="text-sm text-amber-700 font-medium">
            Tu postulación está en revisión — te avisaremos por email apenas la aprobemos.
          </p>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-lg font-bold text-gray-900 flex-1">Detalle de campaña</h1>
        <button onClick={load} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {/* Card combinada: nombre, marca, badge, fechas, fee, brief colapsado */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <div className="flex items-start gap-3 mb-3">
          {c.brand?.logo_url
            ? <img src={c.brand.logo_url} alt={c.brand.name} className="w-11 h-11 rounded-xl object-contain border border-gray-100 flex-shrink-0" />
            : <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-100 to-pink-100 flex items-center justify-center flex-shrink-0">
                <Building2 className="h-5 w-5 text-violet-400" />
              </div>}
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-gray-900 leading-snug">{c.name}</h2>
            {c.brand && <p className="text-sm text-gray-400 mt-0.5">{c.brand.name}</p>}
          </div>
          <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0', campStatus.color)}>
            {campStatus.label}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-3 pt-3 border-t border-gray-50">
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Inicio</p>
            <p className="text-sm font-bold text-gray-900 mt-0.5">{fmtDate(c.start_date)}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Termina</p>
            <p className="text-sm font-bold text-gray-900 mt-0.5">{fmtDate(c.end_date)}</p>
          </div>
          {!!data.fee && (
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Tu fee</p>
              <p className="text-sm font-bold text-gray-900 mt-0.5">{fmtMoney(data.fee, data.currency)}</p>
            </div>
          )}
        </div>

        <CollapsibleBrief text={c.brief || c.description} />
      </div>

      {/* Resumen de entregables */}
      {deliverables.length > 0 && <DeliverablesSummary deliverables={deliverables} />}

      {/* Entregables — acordeón */}
      {sortedDeliverables.length > 0 && (
        <div className="space-y-2.5">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider px-1">Entregables</h2>
          {sortedDeliverables.map(d => <DeliverableRow key={d.id} d={d} onUpdate={load} />)}
        </div>
      )}

      {/* Add deliverable — self-created only */}
      {isSelfCreated && <AddDeliverableForm campaignId={c.id} onAdded={load} />}

      {/* Canjes (solo lectura) */}
      <BartersReadonly endpoint={`/api/influencer/campaigns/${c.id}/barters`} />

      {/* Report PDF */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center flex-shrink-0">
          <Download className="h-5 w-5 text-violet-600" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-gray-900">Reporte de Campaña</p>
          <p className="text-xs text-gray-400">Resumen de entregables y resultados</p>
        </div>
        <a href={`/api/influencer/campaigns/${c.id}/report`} target="_blank" rel="noopener noreferrer"
          className="text-sm font-semibold text-violet-600 hover:text-violet-700 flex items-center gap-1 flex-shrink-0">
          <Download className="h-4 w-4" /> Ver PDF
        </a>
      </div>
    </div>
  )
}
