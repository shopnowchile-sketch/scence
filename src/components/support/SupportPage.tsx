'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Plus, X, AlertCircle, Clock, CheckCircle2,
  Circle, ChevronDown, ChevronUp, RefreshCw, Bot, Loader2, Send,
  User, Building2, ShieldCheck, Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

// ── Types ─────────────────────────────────────────────────────────────────────
interface AIReview {
  severity: 'critical' | 'high' | 'medium' | 'low'
  summary: string
  suggested_steps: string[]
  estimated_priority: 'P0' | 'P1' | 'P2' | 'P3'
}

interface Reply {
  id: string
  message: string
  is_admin: boolean
  user_id: string
  created_at: string
}

interface Submitter {
  name: string
  email: string
  type: 'influencer' | 'brand' | 'admin'
}

interface Ticket {
  id: string
  title: string
  description: string
  status: 'open' | 'in_progress' | 'closed'
  priority: 'P0' | 'P1' | 'P2' | 'P3'
  category: string
  ai_review: AIReview | null
  created_at: string
  submitter?: Submitter | null
}

// ── Config ────────────────────────────────────────────────────────────────────
const STATUS_CONFIG = {
  open:        { label: 'Abierto',     color: 'bg-blue-100 text-blue-700',   icon: Circle },
  in_progress: { label: 'En progreso', color: 'bg-amber-100 text-amber-700', icon: Clock },
  closed:      { label: 'Cerrado',     color: 'bg-gray-100 text-gray-500',   icon: CheckCircle2 },
} as const

const SUBMITTER_TYPE_CONFIG = {
  influencer: { label: 'Influencer', color: 'bg-pink-100 text-pink-700',   icon: User },
  brand:      { label: 'Marca',      color: 'bg-blue-100 text-blue-700',   icon: Building2 },
  admin:      { label: 'Admin',      color: 'bg-gray-100 text-gray-600',   icon: ShieldCheck },
} as const

const PRIORITY_COLOR: Record<string, string> = {
  P0: 'bg-red-100 text-red-700',
  P1: 'bg-orange-100 text-orange-700',
  P2: 'bg-amber-100 text-amber-700',
  P3: 'bg-gray-100 text-gray-500',
}

const SEVERITY_DOT: Record<string, string> = {
  critical: 'bg-red-500',
  high:     'bg-orange-400',
  medium:   'bg-yellow-400',
  low:      'bg-gray-300',
}

const FILTER_TABS = [
  { key: 'all',         label: 'Todos' },
  { key: 'open',        label: 'Abiertos' },
  { key: 'in_progress', label: 'En progreso' },
  { key: 'closed',      label: 'Cerrados' },
]

const CATEGORIES = [
  { value: 'ui',          label: 'Interfaz / visualización' },
  { value: 'api',         label: 'Error de datos / API' },
  { value: 'billing',     label: 'Facturación / pagos' },
  { value: 'auth',        label: 'Acceso / autenticación' },
  { value: 'performance', label: 'Lentitud / rendimiento' },
  { value: 'other',       label: 'Otro' },
]

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// ── Replies sub-component ─────────────────────────────────────────────────────
function TicketReplies({ ticketId, adminMode }: { ticketId: string; adminMode: boolean }) {
  const [replies,  setReplies]  = useState<Reply[]>([])
  const [loading,  setLoading]  = useState(true)
  const [message,  setMessage]  = useState('')
  const [sending,  setSending]  = useState(false)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/tickets/${ticketId}/replies`)
      .then(r => r.json())
      .then(j => setReplies(j.data ?? []))
      .catch(() => toast.error('Error cargando respuestas'))
      .finally(() => setLoading(false))
  }, [ticketId])

  async function sendReply() {
    if (!message.trim()) return
    setSending(true)
    try {
      const res  = await fetch(`/api/tickets/${ticketId}/replies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setReplies(prev => [...prev, json.data])
      setMessage('')
      toast.success('Respuesta enviada')
    } catch (e) {
      toast.error((e as Error).message ?? 'Error enviando respuesta')
    }
    setSending(false)
  }

  if (loading) return <div className="flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin text-gray-300" /></div>

  return (
    <div className="space-y-3 pt-3 border-t border-gray-100">
      <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">Conversación</p>

      {replies.length === 0 && (
        <p className="text-xs text-gray-400 italic">Sin respuestas aún.</p>
      )}

      {replies.map(r => (
        <div key={r.id} className={cn('flex', r.is_admin ? 'justify-end' : 'justify-start')}>
          <div className={cn(
            'max-w-[80%] rounded-2xl px-4 py-2.5 text-sm',
            r.is_admin
              ? 'bg-violet-600 text-white rounded-br-sm'
              : 'bg-gray-100 text-gray-800 rounded-bl-sm'
          )}>
            <p className={cn('text-[10px] font-semibold mb-1', r.is_admin ? 'text-violet-200' : 'text-gray-400')}>
              {r.is_admin ? 'Soporte SCENCE' : 'Tú'}
            </p>
            <p className="leading-relaxed whitespace-pre-wrap">{r.message}</p>
            <p className={cn('text-[10px] mt-1 text-right', r.is_admin ? 'text-violet-300' : 'text-gray-400')}>
              {fmt(r.created_at)}
            </p>
          </div>
        </div>
      ))}

      {/* Reply form — admin only */}
      {adminMode && (
        <div className="flex gap-2 pt-1">
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply() } }}
            placeholder="Escribe una respuesta… (Enter para enviar)"
            rows={2}
            className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-violet-400 bg-gray-50 focus:bg-white transition-colors resize-none"
          />
          <button
            onClick={sendReply}
            disabled={sending || !message.trim()}
            className="self-end p-2.5 bg-violet-600 text-white rounded-xl hover:bg-violet-700 transition-colors disabled:opacity-50"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export function SupportPage({ adminMode = false }: { adminMode?: boolean }) {
  const [tickets,      setTickets]      = useState<Ticket[]>([])
  const [loading,      setLoading]      = useState(true)
  const [showForm,     setShowForm]     = useState(false)
  const [submitting,   setSubmitting]   = useState(false)
  const [expanded,     setExpanded]     = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [form, setForm] = useState({ title: '', description: '', category: 'other' })

  const apiUrl = adminMode ? '/api/tickets' : '/api/support'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const url  = adminMode && statusFilter !== 'all' ? `${apiUrl}?status=${statusFilter}` : apiUrl
      const res  = await fetch(url)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setTickets(json.data ?? [])
    } catch (e) {
      toast.error((e as Error).message ?? 'Error cargando tickets')
    }
    setLoading(false)
  }, [apiUrl, adminMode, statusFilter])

  useEffect(() => { load() }, [load])

  async function submit() {
    if (!form.title.trim())       { toast.error('El título es requerido');     return }
    if (!form.description.trim()) { toast.error('La descripción es requerida'); return }

    setSubmitting(true)
    try {
      const res  = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setTickets(prev => [json.data, ...prev])
      setForm({ title: '', description: '', category: 'other' })
      setShowForm(false)
      toast.success('Ticket enviado — recibirás respuesta pronto')
    } catch (e) {
      toast.error((e as Error).message ?? 'Error enviando ticket')
    }
    setSubmitting(false)
  }

  async function deleteTicket(ticketId: string) {
    if (!confirm('¿Eliminar este ticket? Esta acción no se puede deshacer.')) return
    try {
      const res = await fetch(`/api/tickets/${ticketId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      setTickets(prev => prev.filter(t => t.id !== ticketId))
      if (expanded === ticketId) setExpanded(null)
      toast.success('Ticket eliminado')
    } catch {
      toast.error('Error al eliminar ticket')
    }
  }

  async function updateStatus(ticketId: string, newStatus: string) {
    try {
      const res  = await fetch(`/api/tickets/${ticketId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, status: json.data.status } : t))
      toast.success('Estado actualizado')
    } catch (e) {
      toast.error((e as Error).message ?? 'Error actualizando estado')
    }
  }

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Soporte</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {adminMode ? 'Todos los tickets de soporte de la organización' : 'Reporta un problema o solicita ayuda'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400">
            <RefreshCw className="h-4 w-4" />
          </button>
          {!adminMode && (
            <button
              onClick={() => setShowForm(v => !v)}
              className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700 transition-colors"
            >
              {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {showForm ? 'Cancelar' : 'Nuevo ticket'}
            </button>
          )}
        </div>
      </div>

      {/* Filter tabs — admin only */}
      {adminMode && (
        <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          {FILTER_TABS.map(tab => {
            const count = tab.key === 'all' ? tickets.length : tickets.filter(t => t.status === tab.key).length
            return (
              <button
                key={tab.key}
                onClick={() => setStatusFilter(tab.key)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5',
                  statusFilter === tab.key
                    ? 'bg-white text-violet-700 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                )}
              >
                {tab.label}
                {count > 0 && (
                  <span className={cn(
                    'text-[10px] font-bold px-1.5 py-0.5 rounded-full',
                    statusFilter === tab.key ? 'bg-violet-100 text-violet-700' : 'bg-gray-200 text-gray-500'
                  )}>{count}</span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* Formulario nuevo ticket */}
      {showForm && !adminMode && (
        <div className="bg-white rounded-2xl border border-violet-100 p-6 space-y-4">
          <h2 className="text-sm font-bold text-gray-700">Nuevo ticket de soporte</h2>

          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Título *</label>
            <input
              type="text"
              placeholder="Ej: No puedo ver mis campañas"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-violet-400 bg-gray-50 focus:bg-white transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Descripción *</label>
            <textarea
              placeholder="Describe el problema con el mayor detalle posible..."
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              rows={4}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-violet-400 bg-gray-50 focus:bg-white transition-colors resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Categoría</label>
            <select
              value={form.category}
              onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-violet-400 bg-gray-50 focus:bg-white transition-colors"
            >
              {CATEGORIES.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          <div className="flex justify-end">
            <button
              onClick={submit}
              disabled={submitting}
              className="flex items-center gap-2 px-5 py-2 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700 transition-colors disabled:opacity-60"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {submitting ? 'Enviando...' : 'Enviar ticket'}
            </button>
          </div>
        </div>
      )}

      {/* Lista de tickets */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-10 h-10 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
        </div>
      ) : tickets.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 flex flex-col items-center py-20 gap-3">
          <AlertCircle className="h-10 w-10 text-gray-200" />
          <p className="text-sm font-semibold text-gray-400">No hay tickets</p>
          <p className="text-xs text-gray-400">
            {adminMode ? 'No se han creado tickets aún.' : '¿Encontraste un problema? Crea un ticket y te ayudamos.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {tickets.map(t => {
            const stCfg = STATUS_CONFIG[t.status] ?? STATUS_CONFIG.open
            const StIcon = stCfg.icon
            const isOpen = expanded === t.id

            return (
              <div key={t.id} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                <button
                  className="w-full text-left p-5 hover:bg-gray-50 transition-colors"
                  onClick={() => setExpanded(isOpen ? null : t.id)}
                >
                  <div className="flex items-start justify-between gap-4">
                    {/* Severity dot — admin only */}
                    {adminMode && t.ai_review?.severity && (
                      <div className={cn('w-2 h-2 rounded-full flex-shrink-0 mt-2', SEVERITY_DOT[t.ai_review.severity] ?? 'bg-gray-300')} />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 truncate">{t.title}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{fmt(t.created_at)}</p>
                      {adminMode && (() => {
                        const submitter = t.submitter ?? {
                          name: 'Usuario sin identificar',
                          email: 'Sin email',
                          type: 'admin' as const,
                        }
                        const cfg = SUBMITTER_TYPE_CONFIG[submitter.type]
                        const Icon = cfg.icon
                        return (
                          <div className={cn('inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 rounded-lg text-xs font-medium', cfg.color)}>
                            <Icon className="h-3 w-3 flex-shrink-0" />
                            <span className="opacity-70">Enviado por:</span>
                            <span className="font-semibold">{submitter.name}</span>
                            <span className="opacity-60">·</span>
                            <span className="opacity-80">{submitter.email}</span>
                            <span className="opacity-60">·</span>
                            <span className="font-semibold">{cfg.label}</span>
                          </div>
                        )
                      })()}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={cn('text-[10px] font-bold px-2 py-1 rounded-full', PRIORITY_COLOR[t.priority] ?? PRIORITY_COLOR.P2)}>
                        {t.priority}
                      </span>
                      <span className={cn('text-[10px] font-bold px-2 py-1 rounded-full flex items-center gap-1', stCfg.color)}>
                        <StIcon className="h-3 w-3" /> {stCfg.label}
                      </span>
                      {isOpen
                        ? <ChevronUp className="h-4 w-4 text-gray-300" />
                        : <ChevronDown className="h-4 w-4 text-gray-300" />}
                    </div>
                  </div>
                </button>

                {isOpen && (
                  <div className="px-5 pb-5 space-y-4 border-t border-gray-50">
                    <p className="text-sm text-gray-600 pt-4 whitespace-pre-wrap">{t.description}</p>

                    {/* Admin: cambiar estado + eliminar */}
                    {adminMode && (
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-gray-400">Estado:</span>
                          <div className="flex gap-1.5">
                            {(Object.keys(STATUS_CONFIG) as Array<keyof typeof STATUS_CONFIG>).map(s => (
                              <button
                                key={s}
                                onClick={() => updateStatus(t.id, s)}
                                className={cn(
                                  'text-[10px] font-bold px-3 py-1.5 rounded-full transition-all',
                                  t.status === s
                                    ? STATUS_CONFIG[s].color + ' ring-2 ring-offset-1 ring-current'
                                    : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                                )}
                              >
                                {STATUS_CONFIG[s].label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <button
                          onClick={() => deleteTicket(t.id)}
                          className="flex items-center gap-1 text-xs text-red-400 hover:text-red-600 hover:bg-red-50 px-2 py-1 rounded-lg transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Eliminar
                        </button>
                      </div>
                    )}

                    {/* AI Review */}
                    {t.ai_review && (
                      <div className="bg-violet-50 border border-violet-100 rounded-xl p-4 space-y-2">
                        <div className="flex items-center gap-2">
                          <Bot className="h-4 w-4 text-violet-600" />
                          <span className="text-xs font-bold text-violet-700">Análisis IA</span>
                        </div>
                        <p className="text-sm text-violet-900">{t.ai_review.summary}</p>
                        {t.ai_review.suggested_steps?.length > 0 && (
                          <ul className="space-y-1">
                            {t.ai_review.suggested_steps.map((step, i) => (
                              <li key={i} className="text-xs text-violet-700 flex items-start gap-1.5">
                                <span className="font-bold flex-shrink-0">{i + 1}.</span>
                                {step}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}

                    {/* Replies */}
                    <TicketReplies ticketId={t.id} adminMode={adminMode} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
