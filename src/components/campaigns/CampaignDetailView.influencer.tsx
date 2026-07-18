'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Building2, FileText, Circle, CheckCircle2,
  Clock, Download, RefreshCw,
  Plus, X, Loader2, AlertCircle, ChevronDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { fmtDate, fmtMoney, CAMPAIGN_STATUS } from '@/lib/campaign-utils'
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
  // origin: 'application' (el influencer postuló, la marca decide) vs
  // 'invitation' (la marca invitó, el influencer decide — ver handleRespond).
  origin?: string | null
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
    description: string | null
    content_guidelines: string | null
    brief_url?: string | null
    hashtags: string[] | null; platforms: string[] | null
    start_date: string | null; end_date: string | null
    currency: string
    application_questions?: string[] | null
    brand: { id: string; name: string; logo_url: string | null; website: string | null } | null
  } | null
}

// Preview de campaña open aún no postulada (GET /api/influencer/campaigns/[id])
type PreviewCampaign = {
  id: string; name: string; status: string; visibility: string
  description: string | null; content_guidelines: string | null; brief_url?: string | null
  start_date: string | null; end_date: string | null
  budget_total: number | null; currency: string
  hashtags: string[] | null; platforms: string[] | null
  deliverable_templates: Array<{ type: string; quantity?: number; description?: string }> | null
  application_questions: string[] | null
  application_deadline: string | null
  applications_closed_at: string | null
  max_influencers: number | null
  accepted_count: number
  brand: { id: string; name: string; logo_url: string | null; website: string | null } | null
  _applied: boolean
  application_status: string | null
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
function CollapsibleBrief({ text, guidelines, briefUrl }: { text: string | null; guidelines?: string | null; briefUrl?: string | null }) {
  const [open, setOpen] = useState(false)
  if (!text?.trim() && !guidelines?.trim() && !briefUrl?.trim()) return null
  return (
    <div className="pt-3 mt-3 border-t border-gray-50">
      {/* Más grande + en violeta (color = clickeable, mismo criterio que
          el resto del portal: nombre de campaña, botones Postular/Subir). */}
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center gap-2 text-left">
        <FileText className="h-4 w-4 text-violet-500 flex-shrink-0" />
        <span className="text-sm font-bold text-violet-600 flex-1">Ver brief de la campaña</span>
        <ChevronDown className={cn('h-4 w-4 text-violet-400 flex-shrink-0 transition-transform', open && 'rotate-180')} />
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
          {briefUrl?.trim() && (
            <a
              href={briefUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm font-semibold text-violet-600 hover:text-violet-700"
            >
              <FileText className="h-4 w-4" />
              Abrir brief completo
            </a>
          )}
        </div>
      )}
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
  const [responding, setResponding] = useState(false)
  // Respuestas a las preguntas de postulación (opcional, solo si la campaña
  // tiene application_questions) — pedido de Pri 2026-07-12.
  const [answers, setAnswers] = useState<string[]>([])

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
    const questions = preview.application_questions ?? []
    if (questions.length > 0 && questions.some((_, i) => !answers[i]?.trim())) {
      toast.error('Responde todas las preguntas para postular.')
      return
    }
    if (!confirm(`¿Enviar solicitud para unirte a "${preview.name}"? El equipo la revisará y te confirmará.`)) return
    setApplying(true)
    try {
      const res  = await fetch(`/api/influencer/campaigns/${id}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('¡Solicitud enviada! El equipo te confirmará pronto.')
      setPreview(p => p ? { ...p, _applied: true, application_status: 'pending' } : p)
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error al enviar solicitud')
    }
    setApplying(false)
  }

  async function handleRespond(action: 'accept' | 'reject') {
    if (!id) return
    if (action === 'reject' && !confirm('¿Rechazar esta invitación? No podrás deshacerlo.')) return
    const invitationQuestions = data?.campaign?.application_questions ?? []
    if (action === 'accept' && invitationQuestions.length > 0 && invitationQuestions.some((_, i) => !answers[i]?.trim())) {
      toast.error('Responde todas las preguntas para aceptar la invitación.')
      return
    }
    setResponding(true)
    try {
      const res  = await fetch(`/api/influencer/campaigns/${id}/apply`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, answers }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success(action === 'accept' ? '¡Invitación aceptada!' : 'Invitación rechazada')
      load()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error al responder la invitación')
    }
    setResponding(false)
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
    const deadlinePassed = !!p.application_deadline && new Date(p.application_deadline) < new Date()
    const noSpots = !!p.max_influencers && p.accepted_count >= p.max_influencers
    const applicationsClosed = !!p.applications_closed_at || deadlinePassed || noSpots
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

          {p.max_influencers && (
            <div className="mt-3 rounded-xl bg-violet-50 border border-violet-100 px-3 py-2">
              <p className="text-xs font-bold text-violet-800">Cupos limitados</p>
              <p className="text-xs text-violet-600 mt-0.5">
                {Math.max(p.max_influencers - p.accepted_count, 0)} de {p.max_influencers} cupos disponibles
                {p.application_deadline
                  ? ` · Postula hasta ${new Date(p.application_deadline).toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' })}`
                  : ''}
              </p>
            </div>
          )}

          <CollapsibleBrief text={p.description} guidelines={p.content_guidelines} briefUrl={p.brief_url} />
        </div>

        {/* CTA arriba, antes del detalle de deliverables (pedido: que se vea
            de inmediato, sin scrollear todo el brief primero). */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
          {!p._applied && (p.application_questions?.length ?? 0) > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-gray-500">
                Esta marca pide responder antes de postular:
              </p>
              {(p.application_questions ?? []).map((q, i) => (
                <div key={i}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{q}</label>
                  <textarea
                    rows={2}
                    value={answers[i] ?? ''}
                    onChange={e => setAnswers(a => {
                      const next = [...a]
                      next[i] = e.target.value
                      return next
                    })}
                    className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 outline-none focus:border-violet-400 bg-gray-50 resize-none"
                  />
                </div>
              ))}
            </div>
          )}
          {p._applied ? (
            <div className="flex items-center gap-2 text-sm font-semibold text-green-600">
              <CheckCircle2 className="h-4 w-4" />
              {p.application_status === 'pending'
                ? 'Solicitud enviada — te avisaremos apenas la revisemos.'
                : 'Ya estás vinculada a esta campaña.'}
            </div>
          ) : applicationsClosed ? (
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-500 bg-gray-50 rounded-xl px-4 py-3">
              <Clock className="h-4 w-4" />
              {noSpots ? 'Cupos agotados' : deadlinePassed ? 'El plazo de postulación finalizó' : 'La marca cerró las postulaciones'}
            </div>
          ) : (
            <button onClick={handleApply} disabled={applying}
              className="w-full py-3.5 text-sm font-bold bg-violet-600 text-white rounded-xl hover:bg-violet-700 disabled:opacity-50 transition-colors">
              {applying ? 'Enviando…' : 'Postular a esta campaña'}
            </button>
          )}
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
  // FIX (2026-07-04): mientras la postulación sigue pendiente, el badge del
  // header mostraba el estado de LA CAMPAÑA ("Activa") en vez de reflejar
  // que SU postulación todavía no fue aprobada — inconsistente con
  // "Disponibles para postular" (que sí muestra "En revisión") y con el
  // aviso ámbar de abajo. Mismo caso, dos estados distintos según dónde se
  // mirara (reportado por Pri: ps.cuevasespinoza@gmail.com).
  const campStatus   = isPending
    ? { label: 'En revisión', color: 'bg-amber-100 text-amber-700' }
    : CAMPAIGN_STATUS[c.status] ?? CAMPAIGN_STATUS.draft
  // Nota: campaign_deliverables ya no se lista acá — el detalle de campaña
  // muestra el brief/guías/tags; el progreso y la subida de entregables
  // vive en la tab Entregables (inf-tasks), pedido explícito de Pri para
  // no duplicar la misma información en dos lugares.

  return (
    <div className="space-y-5">
      {/* Invitación de marca pendiente — el influencer decide (accept/reject).
          Antes esto no existía: la marca invitaba y el influencer se quedaba
          viendo "en revisión" para siempre, sin ningún botón para responder. */}
      {isPending && data.origin === 'invitation' && (
        <div className="bg-violet-50 border border-violet-100 rounded-2xl p-4 space-y-3">
          <p className="text-sm text-violet-700 font-medium">
            {c.brand?.name ?? 'Esta marca'} te invitó a participar en esta campaña.
          </p>

          {/* Preguntas antes de aceptar — opcional, la define la marca. Si
              existen, responderlas es obligatorio para poder aceptar (mismo
              mecanismo que la postulación pública). Pedido de Pri 2026-07-12. */}
          {(c.application_questions?.length ?? 0) > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-violet-600">
                Responde antes de aceptar:
              </p>
              {(c.application_questions ?? []).map((q, i) => (
                <div key={i}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{q}</label>
                  <textarea
                    rows={2}
                    value={answers[i] ?? ''}
                    onChange={e => setAnswers(a => {
                      const next = [...a]
                      next[i] = e.target.value
                      return next
                    })}
                    className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 outline-none focus:border-violet-400 bg-white resize-none"
                  />
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={() => handleRespond('reject')} disabled={responding}
              className="flex-1 py-2.5 text-sm font-semibold text-red-600 bg-white border border-red-200 rounded-xl hover:bg-red-50 disabled:opacity-50 transition-colors">
              Rechazar
            </button>
            <button
              onClick={() => handleRespond('accept')}
              disabled={responding || (c.application_questions ?? []).some((_, i) => !answers[i]?.trim())}
              className="flex-1 py-2.5 text-sm font-semibold text-white bg-violet-600 rounded-xl hover:bg-violet-700 disabled:opacity-50 transition-colors">
              {responding ? 'Enviando…' : 'Aceptar invitación'}
            </button>
          </div>
        </div>
      )}

      {/* Postulación propia en revisión — la marca decide, no hay acción acá */}
      {isPending && data.origin !== 'invitation' && (
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

        {/* Brief/guías solo visibles una vez aceptada — mientras esté
            pending (postulación o invitación privada) no se muestra nada
            de esto, solo lo de arriba (nombre, marca, fechas). */}
        {!isPending && <CollapsibleBrief text={c.description} guidelines={c.content_guidelines} briefUrl={c.brief_url} />}
      </div>

      {/* Tags obligatorios de la campaña (plataformas + hashtags) — mismo
          bloque que ya se mostraba en el preview antes de postular; acá
          faltaba. Los entregables (progreso, subir link) viven en la tab
          Entregables del portal, no se repiten en este detalle. Gateado por
          isPending: antes de aceptar no se muestran tags. */}
      {!isPending && ((c.platforms?.length ?? 0) > 0 || (c.hashtags?.length ?? 0) > 0) && (
        <div className="bg-white rounded-2xl border border-gray-100 p-5 flex flex-wrap gap-2">
          {(c.platforms ?? []).map(pl => (
            <span key={pl} className="text-xs font-semibold px-2.5 py-1 rounded-full bg-violet-50 text-violet-600 capitalize">{pl}</span>
          ))}
          {(c.hashtags ?? []).map(h => (
            <span key={h} className="text-xs font-medium px-2.5 py-1 rounded-full bg-gray-100 text-gray-500">#{h.replace(/^#/, '')}</span>
          ))}
        </div>
      )}

      {/* Add deliverable — self-created only */}
      {!isPending && isSelfCreated && <AddDeliverableForm campaignId={c.id} onAdded={load} />}

      {/* Canjes (solo lectura) — entregables/resultados, ocultos hasta aceptar */}
      {!isPending && <BartersReadonly endpoint={`/api/influencer/campaigns/${c.id}/barters`} />}

      {/* Report PDF — resume entregables/resultados, oculto hasta aceptar */}
      {!isPending && (
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
      )}
    </div>
  )
}
