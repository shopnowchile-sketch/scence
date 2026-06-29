'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  Plus, CalendarDays, MapPin, Wifi, Users, Ticket,
  DollarSign, X, Loader2, AlertCircle, ChevronRight,
} from 'lucide-react'
import { format, parseISO, isPast, isFuture } from 'date-fns'
import { es } from 'date-fns/locale'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────
type EventStatus = 'draft' | 'published' | 'canceled' | 'completed'

interface TicketType {
  id: string
  name: string
  price: number
  currency: string
  quantity_total: number
  quantity_sold: number
}

interface Event {
  id: string
  name: string
  description: string | null
  event_date: string
  location: string | null
  is_virtual: boolean
  virtual_link: string | null
  capacity: number | null
  status: EventStatus
  image_url: string | null
  campaign_id: string | null
  ticket_types_count: number
  tickets_sold: number
  revenue_total: number
  event_ticket_types: TicketType[]
}

// ── Status config ─────────────────────────────────────────────────────────────
const STATUS_CFG: Record<EventStatus, { label: string; cls: string }> = {
  draft:     { label: 'Borrador',   cls: 'badge-gray' },
  published: { label: 'Publicado',  cls: 'badge-green' },
  canceled:  { label: 'Cancelado',  cls: 'badge-red' },
  completed: { label: 'Completado', cls: 'badge-blue' },
}

function formatCLP(amount: number) {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(amount)
}

function formatEventDate(dateStr: string) {
  try {
    return format(parseISO(dateStr), "d MMM yyyy, HH:mm", { locale: es })
  } catch {
    return dateStr
  }
}

// ── KPI Cards ─────────────────────────────────────────────────────────────────
function KPIs({ events }: { events: Event[] }) {
  const totalEvents    = events.length
  const totalSold      = events.reduce((s, e) => s + (e.tickets_sold ?? 0), 0)
  const totalRevenue   = events.reduce((s, e) => s + (e.revenue_total ?? 0), 0)
  const upcoming       = events.filter(e => e.status === 'published' && isFuture(parseISO(e.event_date))).length

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {[
        { icon: CalendarDays, color: 'violet',  label: 'Total eventos',      value: String(totalEvents) },
        { icon: Ticket,       color: 'emerald', label: 'Entradas vendidas',  value: String(totalSold) },
        { icon: DollarSign,   color: 'blue',    label: 'Revenue total',      value: totalRevenue > 0 ? formatCLP(totalRevenue) : '—' },
        { icon: CalendarDays, color: 'amber',   label: 'Próximos eventos',   value: String(upcoming) },
      ].map(({ icon: Icon, color, label, value }) => (
        <div key={label} className="card p-4">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-lg bg-${color}-100 flex items-center justify-center flex-shrink-0`}>
              <Icon className={`h-4 w-4 text-${color}-600`} />
            </div>
            <div>
              <div className="text-xl font-bold text-gray-900">{value}</div>
              <div className="text-xs text-gray-400">{label}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Event Card ────────────────────────────────────────────────────────────────
function EventCard({ event, onClick }: { event: Event; onClick: () => void }) {
  const cfg     = STATUS_CFG[event.status] ?? STATUS_CFG.draft
  const sold    = event.tickets_sold ?? 0
  const cap     = event.capacity ?? 0
  const pct     = cap > 0 ? Math.min(Math.round((sold / cap) * 100), 100) : 0
  const isPastEv = isPast(parseISO(event.event_date))

  return (
    <div
      onClick={onClick}
      className="card p-5 cursor-pointer hover:shadow-md hover:border-violet-200 transition-all group"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h3 className="text-sm font-bold text-gray-900 group-hover:text-violet-700 transition-colors truncate">
              {event.name}
            </h3>
            <span className={cn('badge text-[11px]', cfg.cls)}>{cfg.label}</span>
            {event.is_virtual && (
              <span className="badge badge-purple text-[11px] flex items-center gap-1">
                <Wifi className="h-3 w-3" /> Virtual
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 text-xs text-gray-400">
            <CalendarDays className="h-3 w-3 flex-shrink-0" />
            <span className={cn(isPastEv && event.status === 'published' ? 'text-red-400' : '')}>
              {formatEventDate(event.event_date)}
            </span>
          </div>
          {event.location && (
            <div className="flex items-center gap-1 text-xs text-gray-400 mt-0.5">
              <MapPin className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">{event.location}</span>
            </div>
          )}
        </div>
        <ChevronRight className="h-4 w-4 text-gray-300 group-hover:text-violet-400 transition-colors flex-shrink-0 mt-1" />
      </div>

      {/* Capacity bar */}
      {cap > 0 && (
        <div className="mb-3">
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span className="flex items-center gap-1"><Users className="h-3 w-3" />{sold}/{cap} entradas</span>
            <span>{pct}%</span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all',
                pct >= 100 ? 'bg-red-400' : pct > 70 ? 'bg-amber-400' : 'bg-violet-500'
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 pt-2 border-t border-gray-50">
        <div className="flex items-center gap-1 text-xs text-gray-500">
          <Ticket className="h-3 w-3" />
          <span>{event.ticket_types_count ?? 0} tipo{(event.ticket_types_count ?? 0) !== 1 ? 's' : ''} de entrada</span>
        </div>
        {(event.revenue_total ?? 0) > 0 && (
          <div className="flex items-center gap-1 text-xs text-emerald-600 font-semibold ml-auto">
            <DollarSign className="h-3 w-3" />
            {formatCLP(event.revenue_total)}
          </div>
        )}
      </div>
    </div>
  )
}

// ── New Event Modal ───────────────────────────────────────────────────────────
function NewEventModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (event: Event) => void
}) {
  const [form, setForm] = useState({
    name: '',
    description: '',
    event_date: '',
    location: '',
    is_virtual: false,
    virtual_link: '',
    capacity: '',
    campaign_id: '',
  })
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/campaigns?limit=200')
      .then(r => r.json())
      .then(j => setCampaigns(j.data ?? []))
      .catch(() => {})
  }, [])

  const set = (k: string, v: string | boolean) => setForm(f => ({ ...f, [k]: v }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!form.name.trim()) { setError('El nombre es requerido'); return }
    if (!form.event_date)  { setError('La fecha es requerida'); return }

    setSaving(true)
    try {
      const res = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description || null,
          event_date: new Date(form.event_date).toISOString(),
          location: form.is_virtual ? null : (form.location || null),
          is_virtual: form.is_virtual,
          virtual_link: form.is_virtual ? (form.virtual_link || null) : null,
          capacity: form.capacity ? Number(form.capacity) : null,
          campaign_id: form.campaign_id || null,
          status: 'draft',
        }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Error al crear evento'); return }
      toast.success('Evento creado')
      onCreated(json.data)
      onClose()
    } catch {
      setError('Error de red')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">Nuevo Evento</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <div>
            <label className="label">Nombre del evento *</label>
            <input
              className="input-base"
              placeholder="Ej: Fashion Show Spring 2026"
              value={form.name}
              onChange={e => set('name', e.target.value)}
            />
          </div>

          <div>
            <label className="label">Descripción</label>
            <textarea
              className="input-base resize-none h-20"
              placeholder="Descripción del evento..."
              value={form.description}
              onChange={e => set('description', e.target.value)}
            />
          </div>

          <div>
            <label className="label">Fecha y hora *</label>
            <input
              type="datetime-local"
              className="input-base"
              value={form.event_date}
              onChange={e => set('event_date', e.target.value)}
            />
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <div
                onClick={() => set('is_virtual', !form.is_virtual)}
                className={cn(
                  'w-10 h-5 rounded-full transition-colors relative cursor-pointer',
                  form.is_virtual ? 'bg-violet-500' : 'bg-gray-200'
                )}
              >
                <div className={cn(
                  'absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all',
                  form.is_virtual ? 'left-5' : 'left-0.5'
                )} />
              </div>
              <span className="text-sm font-medium text-gray-700">Evento virtual</span>
            </label>
          </div>

          {form.is_virtual ? (
            <div>
              <label className="label">Link del evento</label>
              <input
                className="input-base"
                placeholder="https://meet.google.com/..."
                value={form.virtual_link}
                onChange={e => set('virtual_link', e.target.value)}
              />
            </div>
          ) : (
            <div>
              <label className="label">Ubicación</label>
              <input
                className="input-base"
                placeholder="Ej: Centro de Convenciones, Santiago"
                value={form.location}
                onChange={e => set('location', e.target.value)}
              />
            </div>
          )}

          <div>
            <label className="label">Capacidad total</label>
            <input
              type="number"
              min="1"
              className="input-base"
              placeholder="Ej: 500"
              value={form.capacity}
              onChange={e => set('capacity', e.target.value)}
            />
          </div>

          <div>
            <label className="label">Campaña vinculada (opcional)</label>
            <select
              className="input-base"
              value={form.campaign_id}
              onChange={e => set('campaign_id', e.target.value)}
            >
              <option value="">Sin campaña</option>
              {campaigns.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold text-white bg-violet-600 rounded-lg hover:bg-violet-700 disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {saving ? 'Creando…' : 'Crear evento'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────────
function Skeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="card p-5 animate-pulse space-y-3">
          <div className="h-4 bg-gray-100 rounded-full w-3/4" />
          <div className="h-3 bg-gray-100 rounded-full w-1/2" />
          <div className="h-2 bg-gray-100 rounded-full w-full" />
          <div className="h-3 bg-gray-100 rounded-full w-2/3" />
        </div>
      ))}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function EventsPage() {
  const router = useRouter()
  const [events, setEvents]     = useState<Event[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [showNew, setShowNew]   = useState(false)
  const [statusFilter, setStatusFilter] = useState<string>('')

  async function loadEvents() {
    setLoading(true)
    setError(null)
    try {
      const sp = new URLSearchParams()
      if (statusFilter) sp.set('status', statusFilter)
      const res  = await fetch(`/api/events?${sp.toString()}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Error al cargar eventos')
      setEvents(json.data ?? [])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadEvents() }, [statusFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreated = (event: Event) => {
    setEvents(prev => [event, ...prev])
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Eventos &amp; Entradas</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {loading ? 'Cargando…' : `${events.length} evento${events.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white text-sm font-semibold rounded-lg hover:bg-violet-700 transition-colors shadow-sm shadow-violet-200"
        >
          <Plus className="h-4 w-4" /> Nuevo Evento
        </button>
      </div>

      {/* KPIs */}
      {!loading && !error && <KPIs events={events} />}

      {/* Filter bar */}
      <div className="card p-3 flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider mr-1">Estado:</span>
        {[
          { value: '',          label: 'Todos' },
          { value: 'published', label: 'Publicados' },
          { value: 'draft',     label: 'Borradores' },
          { value: 'completed', label: 'Completados' },
          { value: 'canceled',  label: 'Cancelados' },
        ].map(f => (
          <button
            key={f.value}
            onClick={() => setStatusFilter(f.value)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
              statusFilter === f.value
                ? 'bg-violet-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {error ? (
        <div className="card p-8 text-center">
          <AlertCircle className="h-10 w-10 text-red-300 mx-auto mb-3" />
          <p className="text-sm text-red-500 font-medium">{error}</p>
          <button onClick={loadEvents} className="mt-4 text-sm text-violet-600 hover:underline">
            Reintentar
          </button>
        </div>
      ) : loading ? (
        <Skeleton />
      ) : events.length === 0 ? (
        <div className="card p-12 text-center">
          <CalendarDays className="h-12 w-12 text-gray-200 mx-auto mb-4" />
          <p className="text-sm font-medium text-gray-500 mb-1">No hay eventos</p>
          <p className="text-xs text-gray-400 mb-4">
            {statusFilter ? 'No hay eventos con este estado.' : 'Crea tu primer evento para empezar a vender entradas.'}
          </p>
          {!statusFilter && (
            <button
              onClick={() => setShowNew(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 text-white text-sm font-semibold rounded-lg hover:bg-violet-700 transition-colors"
            >
              <Plus className="h-4 w-4" /> Crear primer evento
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {events.map(ev => (
            <EventCard
              key={ev.id}
              event={ev}
              onClick={() => router.push(`/events/${ev.id}`)}
            />
          ))}
        </div>
      )}

      {showNew && (
        <NewEventModal
          onClose={() => setShowNew(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  )
}
