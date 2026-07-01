'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  CheckCircle2, Circle, Clock, AlertCircle,
  Target, CalendarDays, Banknote,
  ChevronRight, LogOut, RefreshCw,
  Zap, TrendingUp, Sparkles, ExternalLink,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
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
}

type Campaign = {
  id: string
  status: string
  fee: number | null
  currency: string
  campaign: {
    id: string
    name: string
    status: string
    start_date: string | null
    end_date: string | null
    brand: { name: string; logo_url: string | null } | null
  } | null
  campaign_deliverables: Array<{
    id: string
    title: string
    type: string
    status: string
    due_date: string | null
    platform: string | null
  }>
}

type Booking = {
  id: string
  title: string
  starts_at: string
  ends_at: string
  status: string
  location: string | null
  is_virtual: boolean
  virtual_link: string | null
  event_type: string | null
}

type Event = {
  id: string
  name: string
  event_date: string
  location: string | null
  is_virtual: boolean
  status: string
}

type Payment = {
  id: string
  status: string
  gross_amount: number
  net_amount: number
  currency: string
  paid_at: string | null
  description: string | null
  campaign_influencer: { campaign: { name: string } | null } | null
}

type InfluencerProfile = {
  id: string
  display_name: string
  avatar_url: string | null
  email: string | null
}

type OpenCampaign = {
  id: string
  name: string
  status: string
  description: string | null
  start_date: string | null
  end_date: string | null
  brand: { id: string; name: string; logo_url: string | null } | null
  _applied?: boolean   // local state after applying
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const TASK_STATUS_CONFIG = {
  pending:     { label: 'Pendiente',   color: 'bg-amber-100 text-amber-700', icon: Circle },
  in_progress: { label: 'En proceso',  color: 'bg-blue-100 text-blue-700',   icon: Clock },
  done:        { label: 'Completada',  color: 'bg-green-100 text-green-700', icon: CheckCircle2 },
  skipped:     { label: 'Omitida',     color: 'bg-gray-100 text-gray-500',   icon: AlertCircle },
}

const CAMPAIGN_STATUS_COLOR: Record<string, string> = {
  active:    'bg-green-100 text-green-700',
  draft:     'bg-gray-100 text-gray-500',
  completed: 'bg-blue-100 text-blue-700',
  paused:    'bg-amber-100 text-amber-700',
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

function fmtMoney(amount: number, currency: string) {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency, minimumFractionDigits: 0 }).format(amount)
}

// ── Main component ────────────────────────────────────────────────────────────

// ── DeliverableSubmitRow ─────────────────────────────────────────────────────
function DeliverableSubmitRow({
  d, onSubmit,
}: {
  d: { id: string; title?: string | null; type: string; platform?: string | null; due_date?: string | null; status: string }
  onSubmit: () => void
}) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  function urgencyColor(date: string) {
    const days = Math.ceil((new Date(date).getTime() - Date.now()) / 86400000)
    if (days < 0)  return 'text-red-600'
    if (days <= 3) return 'text-amber-500'
    return 'text-gray-400'
  }

  async function handleSubmit() {
    setSaving(true)
    try {
      const res = await fetch(`/api/influencer/deliverables/${d.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content_url: url || null, notes: notes || null }),
      })
      if (!res.ok) throw new Error('Error al enviar')
      setOpen(false)
      onSubmit()
    } catch {
      toast.error('Error al enviar el deliverable. Intenta de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  const statusLabel: Record<string, string> = {
    pending: 'Pendiente', in_review: 'En revisión',
    approved: 'Aprobado', rejected: 'Rechazado', published: 'Publicado',
  }

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-2.5 space-y-2">
      <div className="flex items-center gap-2">
        <Circle className="h-3 w-3 text-gray-300 flex-shrink-0" />
        <span className="text-xs text-gray-700 flex-1 font-medium truncate">{d.title || d.type}</span>
        {d.due_date && (
          <span className={cn('text-[10px] font-medium', urgencyColor(d.due_date))}>
            {Math.ceil((new Date(d.due_date).getTime() - Date.now()) / 86400000) < 0
              ? 'Vencido'
              : `${Math.ceil((new Date(d.due_date).getTime() - Date.now()) / 86400000)}d`}
          </span>
        )}
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
          {statusLabel[d.status] ?? d.status}
        </span>
        {d.status === 'pending' || d.status === 'rejected' ? (
          <button
            onClick={() => setOpen(v => !v)}
            className="text-[10px] font-semibold text-violet-600 hover:underline ml-1 flex-shrink-0"
          >
            {open ? 'Cancelar' : 'Enviar ↑'}
          </button>
        ) : null}
      </div>
      {open && (
        <div className="space-y-1.5 pt-1">
          <input
            type="url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="Link del contenido (Instagram, Drive, etc.)"
            className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-violet-400"
          />
          <input
            type="text"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Notas para el equipo (opcional)"
            className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-violet-400"
          />
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="w-full py-1.5 text-xs font-semibold bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Enviando…' : 'Enviar para revisión'}
          </button>
        </div>
      )}
    </div>
  )
}

export default function InfluencerDashboard() {
  const router  = useRouter()
  const [profile,   setProfile]   = useState<InfluencerProfile | null>(null)
  const [tasks,     setTasks]     = useState<Task[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [bookings,  setBookings]  = useState<Booking[]>([])
  const [events,    setEvents]    = useState<Event[]>([])
  const [payments,  setPayments]  = useState<{ pending: Payment[]; completed: Payment[] }>({ pending: [], completed: [] })
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState<string | null>(null)
  const [openCampaigns, setOpenCampaigns] = useState<OpenCampaign[]>([])
  const [checkingIn,    setCheckingIn]    = useState<string | null>(null)
  const [applying,      setApplying]      = useState<string | null>(null)
  const [brandFilter,   setBrandFilter]   = useState<string>('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [meRes, tasksRes, campRes, evtRes, payRes, openRes] = await Promise.all([
        fetch('/api/influencer/me'),
        fetch('/api/influencer/tasks'),
        fetch('/api/influencer/campaigns'),
        fetch('/api/influencer/events'),
        fetch('/api/influencer/payments'),
        fetch('/api/influencer/campaigns/open'),
      ])

      if (!meRes.ok) {
        const { error: e } = await meRes.json()
        setError(e ?? 'No se encontró tu perfil de influencer.')
        setLoading(false)
        return
      }

      const [meData, tasksData, campData, evtData, payData, openData] = await Promise.all([
        meRes.json(),
        tasksRes.json(),
        campRes.json(),
        evtRes.json(),
        payRes.json(),
        openRes.ok ? openRes.json() : Promise.resolve({ data: [] }),
      ])

      setProfile(meData.data)
      setTasks(tasksData.data ?? [])
      setCampaigns(campData.data ?? [])
      setBookings(evtData.bookings ?? [])
      setEvents(evtData.events ?? [])
      setPayments({ pending: payData.pending ?? [], completed: payData.completed ?? [] })
      setOpenCampaigns(openData.data ?? [])
    } catch {
      setError('Error cargando tu dashboard. Intenta de nuevo.')
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

  async function handleCheckIn(bookingId: string) {
    setCheckingIn(bookingId)
    try {
      const res = await fetch('/api/influencer/bookings/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booking_id: bookingId }),
      })
      if (!res.ok) throw new Error()
      toast.success('¡Check-in realizado!')
      setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, status: 'confirmed' } : b))
    } catch {
      toast.error('Error al hacer check-in')
    }
    setCheckingIn(null)
  }

  async function handleApply(campaignId: string, campaignName: string) {
    if (!confirm(`¿Enviar solicitud para unirte a "${campaignName}"? El equipo la revisará y te confirmará.`)) return
    setApplying(campaignId)
    try {
      const res = await fetch(`/api/influencer/campaigns/${campaignId}/apply`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('¡Solicitud enviada! El equipo te confirmará pronto.')
      setOpenCampaigns(prev => prev.map(c => c.id === campaignId ? { ...c, _applied: true } : c))
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error al enviar solicitud')
    }
    setApplying(null)
  }

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  // ── Loading / error states ─────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-gray-400">Cargando tu portal…</p>
        </div>
      </div>
    )
  }

  // If not an influencer account, redirect to admin dashboard
  if (error && (error.includes('perfil de influencer') || error.includes('Not an influencer'))) {
    router.push('/')
    return null
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center max-w-sm">
          <AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Acceso no disponible</h2>
          <p className="text-sm text-gray-500 mb-6">{error}</p>
          <button onClick={handleSignOut} className="btn-secondary text-sm flex items-center gap-2 mx-auto">
            <LogOut className="h-4 w-4" /> Cerrar sesión
          </button>
        </div>
      </div>
    )
  }

  const pendingTasks  = tasks.filter(t => t.status !== 'done' && t.status !== 'skipped')
  const completedCount = tasks.filter(t => t.status === 'done').length
  const activeCampaigns = campaigns.filter(c => c.campaign?.status === 'active')
  const totalPending  = payments.pending.reduce((s, p) => s + p.net_amount, 0)
  const totalPaid     = payments.completed.reduce((s, p) => s + p.net_amount, 0)
  const currency      = payments.pending[0]?.currency ?? payments.completed[0]?.currency ?? 'CLP'

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-full bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
            {profile?.display_name?.charAt(0).toUpperCase() ?? '?'}
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Hola, {profile?.display_name} 👋</h1>
            <p className="text-sm text-gray-400">{new Date().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors" title="Actualizar">
            <RefreshCw className="h-4 w-4" />
          </button>
          <button onClick={handleSignOut} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors" title="Cerrar sesión">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* KPI strip — clickeables */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Tareas pendientes', value: pendingTasks.length,    icon: Zap,         color: 'text-amber-600',  bg: 'bg-amber-50',   href: '/tasks' },
          { label: 'Campañas activas',  value: activeCampaigns.length, icon: Target,      color: 'text-violet-600', bg: 'bg-violet-50',  href: '#campaigns' },
          { label: 'Por cobrar',        value: fmtMoney(totalPending, currency), icon: Banknote, color: 'text-red-600',    bg: 'bg-red-50',    href: null },
          { label: 'Cobrado',           value: fmtMoney(totalPaid, currency),    icon: TrendingUp, color: 'text-green-600', bg: 'bg-green-50', href: null },
        ].map(({ label, value, icon: Icon, color, bg, href }) => {
          const content = (
            <>
              <div className={cn('w-8 h-8 rounded-xl flex items-center justify-center mb-3', bg)}>
                <Icon className={cn('h-4 w-4', color)} />
              </div>
              <div className="text-xl font-bold text-gray-900">{value}</div>
              <div className="text-xs text-gray-400 mt-0.5">{label}</div>
            </>
          )
          return href ? (
            <a key={label} href={href} className="bg-white rounded-2xl border border-gray-100 p-4 hover:border-violet-200 hover:shadow-sm transition-all block">
              {content}
            </a>
          ) : (
            <div key={label} className="bg-white rounded-2xl border border-gray-100 p-4">
              {content}
            </div>
          )
        })}
      </div>

      {/* Gráfico de avance de campañas */}
      {activeCampaigns.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-4">Avance de campañas</h2>
          <div className="space-y-4">
            {activeCampaigns.map(ci => {
              const c = ci.campaign!
              const total = ci.campaign_deliverables?.length ?? 0
              const done  = ci.campaign_deliverables?.filter((d: {status:string}) => d.status === 'approved' || d.status === 'published').length ?? 0
              const pct   = total > 0 ? Math.round((done / total) * 100) : 0
              return (
                <div key={ci.id}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      {c.brand?.logo_url && <img src={c.brand.logo_url} alt="" className="w-5 h-5 rounded object-contain flex-shrink-0" />}
                      <span className="text-sm font-medium text-gray-900 truncate">{c.name}</span>
                    </div>
                    <span className="text-xs font-bold text-gray-500 flex-shrink-0 ml-2">{done}/{total} · {pct}%</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={cn('h-full rounded-full transition-all', pct === 100 ? 'bg-green-500' : 'bg-violet-500')}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── SECTION 1: Tareas pendientes ────────────────────────────────────── */}
      <Section title="Tareas Pendientes" icon={Zap} count={pendingTasks.length} badge="amber">
        {pendingTasks.length === 0 ? (
          <EmptyState icon={CheckCircle2} text={`¡Todo al día! ${completedCount > 0 ? `Completaste ${completedCount} tarea${completedCount > 1 ? 's' : ''}.` : ''}`} />
        ) : (
          <div className="divide-y divide-gray-50">
            {pendingTasks.map(task => {
              const cfg = TASK_STATUS_CONFIG[task.status]
              const StatusIcon = cfg.icon
              return (
                <div key={task.id} className="flex items-start gap-3 py-3 px-1 group">
                  {/* Quick complete button */}
                  <button
                    onClick={() => updateTaskStatus(task.id, task.status === 'done' ? 'pending' : 'done')}
                    className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full border-2 border-gray-200 hover:border-violet-400 hover:bg-violet-50 transition-colors flex items-center justify-center"
                    title="Marcar como completada"
                  >
                    <CheckCircle2 className="h-3 w-3 text-transparent group-hover:text-violet-400 transition-colors" />
                  </button>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-gray-900">{task.title}</span>
                      <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-full', cfg.color)}>
                        {cfg.label}
                      </span>
                      {task.source_type !== 'manual' && (
                        <span className="text-[10px] text-gray-300 capitalize">{task.source_type}</span>
                      )}
                    </div>
                    {task.description && (
                      <p className="text-xs text-gray-400 mt-0.5 truncate">{task.description}</p>
                    )}
                  </div>

                  <div className="flex-shrink-0 text-right">
                    {task.due_date && (
                      <>
                        <div className={cn('text-xs font-medium', urgencyColor(task.due_date))}>
                          {daysUntil(task.due_date)}
                        </div>
                        <div className="text-[10px] text-gray-300">{formatDate(task.due_date)}</div>
                      </>
                    )}
                  </div>

                  {/* Status toggle */}
                  <select
                    value={task.status}
                    onChange={e => updateTaskStatus(task.id, e.target.value as Task['status'])}
                    className="text-[11px] border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-600 focus:outline-none focus:ring-1 focus:ring-violet-300 flex-shrink-0"
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
      </Section>

      {/* ── SECTION 2: Campañas Activas ─────────────────────────────────────── */}
      <Section title="Campañas Activas" icon={Target} count={activeCampaigns.length} badge="violet">
        {activeCampaigns.length === 0 ? (
          <EmptyState icon={Target} text="No tienes campañas activas en este momento." />
        ) : (
          <div className="space-y-3">
            {activeCampaigns.map(ci => {
              const c = ci.campaign!
              const statusCfg = CAMPAIGN_STATUS_COLOR[c.status] ?? 'bg-gray-100 text-gray-500'
              const pendingDeliverables = ci.campaign_deliverables.filter(d => d.status !== 'approved' && d.status !== 'published')
              return (
                <div key={ci.id} className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-gray-900 truncate">{c.name}</span>
                        <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-full capitalize', statusCfg)}>
                          {c.status}
                        </span>
                      </div>
                      {c.brand && (
                        <p className="text-xs text-gray-400 mt-0.5">{c.brand.name}</p>
                      )}
                      <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                        {c.start_date && <span>Inicio: {formatDate(c.start_date)}</span>}
                        {c.end_date && <span>Fin: {formatDate(c.end_date)}</span>}
                        {ci.fee && (
                          <span className="font-medium text-gray-600">{fmtMoney(ci.fee, ci.currency)}</span>
                        )}
                      </div>
                    </div>
                    <a href={`/inf-campaign/${c.id}`} className="p-1 hover:bg-gray-200 rounded-lg transition-colors flex-shrink-0">
                      <ExternalLink className="h-4 w-4 text-gray-400" />
                    </a>
                  </div>

                  {/* Deliverables */}
                  {pendingDeliverables.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-200 space-y-2">
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Entregables pendientes</p>
                      {pendingDeliverables.map(d => (
                        <DeliverableSubmitRow key={d.id} d={d} onSubmit={load} />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Section>

      {/* ── SECTION 3: Campañas disponibles ────────────────────────────────── */}
      {openCampaigns.length > 0 && (
        <Section title="Campañas Disponibles" icon={Sparkles} count={openCampaigns.length} badge="violet">
          <div className="space-y-3">
            {/* Brand filter */}
            {(() => {
              const brands = openCampaigns.map(c => c.brand?.name).filter((b): b is string => !!b)
              const unique = brands.filter((b, i) => brands.indexOf(b) === i)
              return unique.length > 1 ? (
              <div className="flex gap-2 flex-wrap pb-1">
                <button onClick={() => setBrandFilter('')}
                  className={cn('text-xs font-semibold px-3 py-1 rounded-full border transition-colors',
                    brandFilter === '' ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-gray-500 border-gray-200 hover:border-violet-300')}>
                  Todas
                </button>
                {unique.map(brand => (
                  <button key={brand} onClick={() => setBrandFilter(brand === brandFilter ? '' : brand)}
                    className={cn('text-xs font-semibold px-3 py-1 rounded-full border transition-colors',
                      brandFilter === brand ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-gray-500 border-gray-200 hover:border-violet-300')}>
                    {brand}
                  </button>
                ))}
              </div>
              ) : null
            })()}

            {openCampaigns
              .filter(c => !brandFilter || c.brand?.name === brandFilter)
              .map(c => (
              <div key={c.id} className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                <div className="flex items-start gap-3">
                  {/* Brand logo */}
                  {c.brand?.logo_url ? (
                    <img src={c.brand.logo_url} alt={c.brand.name} className="w-9 h-9 rounded-lg object-contain bg-white border border-gray-100 flex-shrink-0" />
                  ) : (
                    <div className="w-9 h-9 rounded-lg bg-violet-100 flex items-center justify-center flex-shrink-0 text-xs font-bold text-violet-600">
                      {c.brand?.name?.charAt(0) ?? '?'}
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-900 truncate">{c.name}</span>
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">Abierta</span>
                    </div>
                    {c.brand && <p className="text-xs font-medium text-violet-600 mt-0.5">{c.brand.name}</p>}
                    {c.description && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{c.description}</p>}
                    {(c.start_date || c.end_date) && (
                      <p className="text-[10px] text-gray-400 mt-1">
                        {c.start_date ? new Date(c.start_date).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' }) : '—'}
                        {' → '}
                        {c.end_date ? new Date(c.end_date).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                      </p>
                    )}
                  </div>

                  {/* Detalle + apply */}
                  <div className="flex-shrink-0 flex flex-col items-end gap-1.5">
                    <Link href={`/inf-campaign/${c.id}`}
                      className="text-[10px] font-semibold text-gray-400 hover:text-violet-600 transition-colors">
                      Ver detalles
                    </Link>
                    {c._applied ? (
                      <span className="text-[10px] font-bold text-green-600">✓ Enviada</span>
                    ) : (
                      <button
                        onClick={() => handleApply(c.id, c.name)}
                        disabled={applying === c.id}
                        className="text-xs font-bold bg-violet-600 text-white px-3 py-1.5 rounded-lg hover:bg-violet-700 disabled:opacity-50 transition-colors"
                      >
                        {applying === c.id ? '…' : 'Aplicar'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ── SECTION 4: Próximos Eventos ─────────────────────────────────────── */}
      <Section title="Próximos Eventos" icon={CalendarDays} count={bookings.length + events.length} badge="blue">
        {bookings.length === 0 && events.length === 0 ? (
          <EmptyState icon={CalendarDays} text="No tienes eventos ni sesiones próximas." />
        ) : (
          <div className="space-y-2">
            {/* Bookings with check-in */}
            {bookings.map(b => {
              const isToday = Math.abs(new Date(b.starts_at).getTime() - Date.now()) < 86400000 * 2
              return (
                <div key={`booking-${b.id}`} className="flex items-center gap-3 py-2.5 px-3 rounded-xl bg-gray-50 border border-gray-100">
                  <div className="flex-shrink-0 text-center min-w-[40px]">
                    <div className="text-lg font-bold text-gray-900 leading-none">{new Date(b.starts_at).getDate()}</div>
                    <div className="text-[10px] text-gray-400 uppercase">{new Date(b.starts_at).toLocaleDateString('es-CL', { month: 'short' })}</div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900 truncate">{b.title}</span>
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 bg-violet-100 text-violet-700">Sesión</span>
                    </div>
                    {b.location && <p className="text-xs text-gray-400 mt-0.5 truncate">{b.is_virtual ? '🔗 ' : '📍 '}{b.is_virtual ? (b.virtual_link ?? 'Virtual') : b.location}</p>}
                  </div>
                  <div className="flex-shrink-0 flex flex-col items-end gap-1">
                    <span className="text-xs font-medium text-gray-500">{new Date(b.starts_at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</span>
                    {isToday && b.status !== 'confirmed' && (
                      <button
                        onClick={() => handleCheckIn(b.id)}
                        disabled={checkingIn === b.id}
                        className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
                      >
                        {checkingIn === b.id ? '…' : 'Check-in'}
                      </button>
                    )}
                    {b.status === 'confirmed' && (
                      <span className="text-[10px] font-bold text-green-600">✓ Confirmado</span>
                    )}
                  </div>
                </div>
              )
            })}
            {/* Events */}
            {events.map(e => (
              <EventRow
                key={`event-${e.id}`}
                title={e.name}
                date={e.event_date}
                label="Evento"
                labelColor="bg-blue-100 text-blue-700"
                location={e.is_virtual ? 'Virtual' : e.location}
                isVirtual={e.is_virtual}
              />
            ))}
          </div>
        )}
      </Section>

      {/* ── SECTION 4: Pagos ────────────────────────────────────────────────── */}
      <Section title="Pagos" icon={Banknote} badge="green">
        {payments.pending.length === 0 && payments.completed.length === 0 ? (
          <EmptyState icon={Banknote} text="No tienes pagos registrados aún." />
        ) : (
          <div className="space-y-4">
            {/* Pending */}
            {payments.pending.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Por cobrar</p>
                <div className="space-y-2">
                  {payments.pending.map(p => (
                    <PaymentRow key={p.id} payment={p} />
                  ))}
                </div>
                <div className="mt-2 pt-2 border-t border-gray-100 flex justify-end">
                  <span className="text-sm font-bold text-red-600">
                    Total: {fmtMoney(totalPending, currency)}
                  </span>
                </div>
              </div>
            )}

            {/* Completed */}
            {payments.completed.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Pagos realizados</p>
                <div className="space-y-2">
                  {payments.completed.slice(0, 5).map(p => (
                    <PaymentRow key={p.id} payment={p} completed />
                  ))}
                </div>
                <div className="mt-2 pt-2 border-t border-gray-100 flex justify-end">
                  <span className="text-sm font-bold text-green-600">
                    Total cobrado: {fmtMoney(totalPaid, currency)}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </Section>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Section({
  title, icon: Icon, count, badge, children
}: {
  title: string
  icon: React.ElementType
  count?: number
  badge?: 'amber' | 'violet' | 'blue' | 'green'
  children: React.ReactNode
}) {
  const badgeColors = {
    amber:  'bg-amber-100 text-amber-700',
    violet: 'bg-violet-100 text-violet-700',
    blue:   'bg-blue-100 text-blue-700',
    green:  'bg-green-100 text-green-700',
  }
  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-50">
        <Icon className="h-4 w-4 text-gray-400" />
        <h2 className="text-sm font-bold text-gray-900 flex-1">{title}</h2>
        {count !== undefined && count > 0 && badge && (
          <span className={cn('text-xs font-bold px-2 py-0.5 rounded-full', badgeColors[badge])}>
            {count}
          </span>
        )}
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  )
}

function EmptyState({ icon: Icon, text }: { icon: React.ElementType; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <Icon className="h-8 w-8 text-gray-200 mb-3" />
      <p className="text-sm text-gray-400">{text}</p>
    </div>
  )
}

function EventRow({
  title, date, label, labelColor, location, isVirtual
}: {
  title: string
  date: string
  label: string
  labelColor: string
  location: string | null | undefined
  isVirtual: boolean
}) {
  return (
    <div className="flex items-center gap-3 py-2.5 px-3 rounded-xl bg-gray-50 border border-gray-100">
      <div className="flex-shrink-0 text-center min-w-[40px]">
        <div className="text-lg font-bold text-gray-900 leading-none">
          {new Date(date).getDate()}
        </div>
        <div className="text-[10px] text-gray-400 uppercase">
          {new Date(date).toLocaleDateString('es-CL', { month: 'short' })}
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900 truncate">{title}</span>
          <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0', labelColor)}>
            {label}
          </span>
        </div>
        {location && (
          <p className="text-xs text-gray-400 mt-0.5 truncate">
            {isVirtual ? '🔗 ' : '📍 '}{location}
          </p>
        )}
      </div>
      <div className="flex-shrink-0 text-xs font-medium text-gray-500">
        {new Date(date).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
      </div>
    </div>
  )
}

function PaymentRow({ payment, completed = false }: { payment: Payment; completed?: boolean }) {
  const campaign = payment.campaign_influencer?.campaign?.name
  const statusLabel: Record<string, string> = {
    pending:    'Pendiente',
    processing: 'Procesando',
    paid:       'Pagado',
    failed:     'Fallido',
  }
  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className={cn('w-2 h-2 rounded-full flex-shrink-0', completed ? 'bg-green-400' : 'bg-amber-400')} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">
          {payment.description ?? campaign ?? 'Pago campaña'}
        </p>
        {campaign && payment.description && (
          <p className="text-xs text-gray-400 truncate">{campaign}</p>
        )}
        {payment.paid_at && (
          <p className="text-[10px] text-gray-300">
            {new Date(payment.paid_at).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' })}
          </p>
        )}
      </div>
      <div className="text-right flex-shrink-0">
        <div className={cn('text-sm font-bold', completed ? 'text-green-700' : 'text-gray-900')}>
          {new Intl.NumberFormat('es-CL', { style: 'currency', currency: payment.currency, minimumFractionDigits: 0 }).format(payment.net_amount)}
        </div>
        <div className="text-[10px] text-gray-400">{statusLabel[payment.status] ?? payment.status}</div>
      </div>
    </div>
  )
}
