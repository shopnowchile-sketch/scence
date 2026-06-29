'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  CheckCircle2, Circle, Clock, AlertCircle,
  Zap, RefreshCw, Filter, Link2, ExternalLink, Upload, ChevronRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

// ── Types ─────────────────────────────────────────────────────────────────────

type Task = {
  id: string
  title: string
  description: string | null
  due_date: string | null
  status: 'pending' | 'in_progress' | 'done' | 'skipped'
  source_type: 'campaign' | 'booking' | 'event' | 'manual'
  source_id: string | null
  deliverable_id: string | null  // vinculado a campaign_deliverable
}

type Deliverable = {
  id: string
  title: string | null
  type: string
  platform: string | null
  due_date: string | null
  status: string
  content_url: string | null
  campaign_id: string
  campaign_name: string
  campaign_influencer_id: string
}

type StatusFilter = 'all' | Task['status']

// ── Helpers ───────────────────────────────────────────────────────────────────

const TASK_STATUS_CONFIG = {
  pending:     { label: 'Pendiente',   color: 'bg-amber-100 text-amber-700',  icon: Circle },
  in_progress: { label: 'En proceso',  color: 'bg-blue-100 text-blue-700',    icon: Clock },
  done:        { label: 'Completada',  color: 'bg-green-100 text-green-700',  icon: CheckCircle2 },
  skipped:     { label: 'Omitida',     color: 'bg-gray-100 text-gray-500',    icon: AlertCircle },
}

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

// ── Deliverable row (reel link + submit) ─────────────────────────────────────

function DeliverableRow({ d, onUpdate }: { d: Deliverable; onUpdate: () => void }) {
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

  return (
    <div className={cn('border rounded-xl p-3.5 space-y-2', isDone ? 'border-green-100 bg-green-50/30' : 'border-gray-100 bg-white')}>
      <div className="flex items-start gap-3">
        {/* Status icon */}
        <div className="mt-0.5 flex-shrink-0">
          {isDone
            ? <CheckCircle2 className="h-4 w-4 text-green-500" />
            : d.status === 'in_review'
            ? <Clock className="h-4 w-4 text-blue-500" />
            : <Circle className="h-4 w-4 text-gray-300" />}
        </div>

        <div className="flex-1 min-w-0">
          {/* Campaign badge */}
          <button
            onClick={() => router.push(`/campaign/${d.campaign_id}`)}
            className="text-[10px] font-semibold text-violet-600 hover:text-violet-700 hover:underline flex items-center gap-0.5 mb-1"
          >
            {d.campaign_name} <ChevronRight className="h-2.5 w-2.5" />
          </button>

          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn('text-sm font-medium', isDone ? 'text-gray-400 line-through' : 'text-gray-900')}>
              {d.title || d.type}
            </span>
            <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full', cfg.color)}>{cfg.label}</span>
            {d.platform && <span className="text-[10px] text-gray-400 capitalize">{d.platform}</span>}
          </div>

          {d.due_date && !isDone && (
            <div className="flex items-center gap-1.5 mt-1">
              <span className="text-[10px] text-gray-300">Vence:</span>
              <span className={cn('text-[10px] font-medium', urgencyColor(d.due_date))}>
                {daysUntil(d.due_date)} · {formatDate(d.due_date)}
              </span>
            </div>
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
              className="flex items-center gap-1 text-xs font-semibold text-violet-600 hover:text-violet-700 px-2 py-1 rounded-lg hover:bg-violet-50 transition-colors"
            >
              <Upload className="h-3.5 w-3.5" />
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

export default function TasksPage() {
  const [tasks,        setTasks]        = useState<Task[]>([])
  const [deliverables, setDeliverables] = useState<Deliverable[]>([])
  const [loading,      setLoading]      = useState(true)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [activeTab,    setActiveTab]    = useState<'deliverables' | 'tasks'>('deliverables')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [tasksRes, campRes] = await Promise.all([
        fetch('/api/influencer/tasks'),
        fetch('/api/influencer/campaigns'),
      ])
      const [tasksData, campData] = await Promise.all([tasksRes.json(), campRes.json()])
      setTasks(tasksData.data ?? [])

      // Build deliverables from campaign_influencers
      const delivs: Deliverable[] = []
      for (const ci of (campData.data ?? [])) {
        const c = ci.campaign
        if (!c) continue
        for (const d of (ci.campaign_deliverables ?? [])) {
          delivs.push({
            id: d.id,
            title: d.title,
            type: d.type,
            platform: d.platform,
            due_date: d.due_date,
            status: d.status,
            content_url: d.content_url ?? null,
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
      toast.error('Error cargando tareas')
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function updateTaskStatus(taskId: string, newStatus: Task['status']) {
    const prev = tasks
    setTasks(t => t.map(x => x.id === taskId ? { ...x, status: newStatus } : x))
    const res = await fetch(`/api/influencer/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    if (!res.ok) {
      setTasks(prev)
      toast.error('No se pudo actualizar la tarea')
    } else {
      toast.success(newStatus === 'done' ? '¡Tarea completada!' : 'Tarea actualizada')
    }
  }

  const filtered = tasks.filter(t => statusFilter === 'all' || t.status === statusFilter)
  const pendingDeliverables = deliverables.filter(d => d.status !== 'approved' && d.status !== 'published')
  const doneDeliverables    = deliverables.filter(d => d.status === 'approved' || d.status === 'published')

  const counts = {
    all:         tasks.length,
    pending:     tasks.filter(t => t.status === 'pending').length,
    in_progress: tasks.filter(t => t.status === 'in_progress').length,
    done:        tasks.filter(t => t.status === 'done').length,
    skipped:     tasks.filter(t => t.status === 'skipped').length,
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-gray-400">Cargando tareas…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Mis Tareas</h1>
          <p className="text-sm text-gray-400 mt-0.5">{pendingDeliverables.length} entregables pendientes</p>
        </div>
        <button onClick={load} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
        {([
          { key: 'deliverables', label: `Entregables (${pendingDeliverables.length})` },
          { key: 'tasks',        label: `Todas mis tareas (${counts.all})` },
        ] as { key: typeof activeTab; label: string }[]).map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'flex-1 text-sm font-semibold py-2 rounded-lg transition-colors',
              activeTab === tab.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── DELIVERABLES TAB ── */}
      {activeTab === 'deliverables' && (
        <div className="space-y-4">
          {/* Pending */}
          <div>
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Zap className="h-3.5 w-3.5 text-amber-500" /> Pendientes · {pendingDeliverables.length}
            </h2>
            {pendingDeliverables.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-100 flex flex-col items-center py-10">
                <CheckCircle2 className="h-8 w-8 text-gray-200 mb-2" />
                <p className="text-sm text-gray-400">¡Todo al día con los entregables!</p>
              </div>
            ) : (
              <div className="space-y-2">
                {pendingDeliverables.map(d => <DeliverableRow key={d.id} d={d} onUpdate={load} />)}
              </div>
            )}
          </div>

          {/* Done */}
          {doneDeliverables.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> Aprobados · {doneDeliverables.length}
              </h2>
              <div className="space-y-2">
                {doneDeliverables.map(d => <DeliverableRow key={d.id} d={d} onUpdate={load} />)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── TASKS TAB ── */}
      {activeTab === 'tasks' && (
        <div className="space-y-4">
          {/* Status filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="h-4 w-4 text-gray-300 flex-shrink-0" />
            {([
              { key: 'all',         label: 'Todas',      count: counts.all },
              { key: 'pending',     label: 'Pendiente',  count: counts.pending },
              { key: 'in_progress', label: 'En proceso', count: counts.in_progress },
              { key: 'done',        label: 'Completadas', count: counts.done },
            ] as { key: StatusFilter; label: string; count: number }[]).map(({ key, label, count }) => (
              <button
                key={key}
                onClick={() => setStatusFilter(key)}
                className={cn(
                  'text-xs font-medium px-3 py-1.5 rounded-full border transition-colors',
                  statusFilter === key
                    ? 'bg-violet-600 text-white border-violet-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-violet-300'
                )}
              >
                {label} {count > 0 && <span className="ml-1 opacity-70">{count}</span>}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 flex flex-col items-center py-16">
              <CheckCircle2 className="h-10 w-10 text-gray-200 mb-3" />
              <p className="text-sm text-gray-400">No hay tareas para este filtro.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map(task => {
                const cfg = TASK_STATUS_CONFIG[task.status]
                const StatusIcon = cfg.icon

                // Si la task tiene deliverable vinculado, buscar el deliverable y renderizarlo
                if (task.deliverable_id) {
                  const linked = deliverables.find(d => d.id === task.deliverable_id)
                  if (linked) {
                    return <DeliverableRow key={task.id} d={linked} onUpdate={load} />
                  }
                }

                // Task genérica (sin deliverable vinculado)
                return (
                  <div key={task.id} className="flex items-start gap-3 py-3.5 px-4 bg-white rounded-xl border border-gray-100 group">
                    <button
                      onClick={() => updateTaskStatus(task.id, task.status === 'done' ? 'pending' : 'done')}
                      className={cn(
                        'mt-0.5 flex-shrink-0 w-5 h-5 rounded-full border-2 transition-colors flex items-center justify-center',
                        task.status === 'done' ? 'border-green-400 bg-green-50' : 'border-gray-200 hover:border-violet-400 hover:bg-violet-50'
                      )}
                    >
                      <StatusIcon className={cn('h-3 w-3', task.status === 'done' ? 'text-green-500' : 'text-transparent group-hover:text-violet-400')} />
                    </button>
                    <div className="flex-1 min-w-0">
                      {task.source_type === 'campaign' && task.source_id && (
                        <span className="text-[10px] font-semibold text-violet-500 block mb-0.5">Campaña</span>
                      )}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={cn('text-sm font-medium', task.status === 'done' ? 'text-gray-400 line-through' : 'text-gray-900')}>
                          {task.title}
                        </span>
                        <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-full', cfg.color)}>{cfg.label}</span>
                      </div>
                      {task.description && <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{task.description}</p>}
                      {task.due_date && (
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className="text-[10px] text-gray-300">Vence:</span>
                          <span className={cn('text-[10px] font-medium', urgencyColor(task.due_date))}>
                            {daysUntil(task.due_date)} · {formatDate(task.due_date)}
                          </span>
                        </div>
                      )}
                    </div>
                    <select
                      value={task.status}
                      onChange={e => updateTaskStatus(task.id, e.target.value as Task['status'])}
                      className="text-[11px] border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-600 focus:outline-none flex-shrink-0"
                    >
                      <option value="pending">Pendiente</option>
                      <option value="in_progress">En proceso</option>
                      <option value="done">Completada</option>
                      <option value="skipped">Omitir</option>
                    </select>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
