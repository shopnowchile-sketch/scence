'use client'

import { useState, useCallback, useEffect } from 'react'
import {
  Plus, ChevronLeft, ChevronRight,
  List, MapPin, ExternalLink,
  Video, CheckCircle2, Clock, X, CalendarDays, Loader2, FileText,
} from 'lucide-react'
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, isSameMonth, isSameDay, isToday,
  addMonths, subMonths, parseISO,
} from 'date-fns'
import { es } from 'date-fns/locale'
import { cn, formatCurrency } from '@/lib/utils'
import { AddressWithMap } from '@/components/maps/GoogleMap'
import type { Booking, BookingStatus } from '@/types'
import { useBookings, useUpdateBookingStatus, useCancelBooking, useCreateBooking } from '@/hooks/useBookings'

// ── New Booking Modal ─────────────────────────────────────────────────────────
function NewBookingModal({ onClose }: { onClose: () => void }) {
  const createBooking = useCreateBooking()
  const [form, setForm] = useState({
    title: '',
    event_type: 'event',
    starts_at: '',
    ends_at: '',
    is_virtual: false,
    location: '',
    virtual_link: '',
    fee: '',
    currency: 'CLP',
    description: '',
    notes: '',
    campaign_id: '',
  })
  const [selectedInfluencers, setSelectedInfluencers] = useState<string[]>([])
  const [influencers, setInfluencers] = useState<{ id: string; display_name: string; email?: string }[]>([])
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([])
  const [formError, setFormError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    fetch('/api/influencers?limit=200&sort_by=display_name&sort_dir=asc').then(r => r.json()).then(j => setInfluencers(j.data ?? []))
    fetch('/api/campaigns?limit=200').then(r => r.json()).then(j => setCampaigns(j.data ?? []))
  }, [])

  const set = (k: string, v: string | boolean) => setForm(f => ({ ...f, [k]: v }))
  const toggleInfluencer = (id: string) => setSelectedInfluencers(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)
    if (!form.title || !form.starts_at || !form.ends_at) return
    if (selectedInfluencers.length === 0) {
      setFormError('Debes seleccionar al menos una influencer')
      return
    }
    setSending(true)
    try {
      // Single booking with all influencers — backend handles booking_influencers
      await createBooking.mutateAsync({
        title: form.title,
        event_type: form.event_type,
        starts_at: new Date(form.starts_at).toISOString(),
        ends_at: new Date(form.ends_at).toISOString(),
        is_virtual: form.is_virtual,
        location: form.is_virtual ? null : form.location || null,
        virtual_link: form.is_virtual ? form.virtual_link || null : null,
        fee: form.fee ? Number(form.fee) : null,
        currency: form.currency || 'CLP',
        description: form.description || null,
        notes: form.notes || null,
        influencer_id: selectedInfluencers[0],
        influencer_ids: selectedInfluencers,
        campaign_id: form.campaign_id || null,
        confirmation_status: 'pending',
      })
      // Send confirmation emails
      await fetch('/api/bookings/send-confirmations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          influencer_ids: selectedInfluencers,
          title: form.title,
          starts_at: form.starts_at,
          ends_at: form.ends_at,
          location: form.is_virtual ? form.virtual_link : form.location,
          is_virtual: form.is_virtual,
          description: form.description,
        }),
      })
      onClose()
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">Nuevo Booking</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Título */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Título *</label>
            <input className="input-base" value={form.title} onChange={e => set('title', e.target.value)} placeholder="Sesión de fotos, Evento, Live..." required />
          </div>

          {/* Tipo */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Tipo de evento</label>
            <select className="input-base" value={form.event_type} onChange={e => set('event_type', e.target.value)}>
              <option value="event">Evento</option>
              <option value="shoot">Sesión fotográfica</option>
              <option value="live">Live / Stream</option>
              <option value="meeting">Reunión</option>
            </select>
          </div>

          {/* Fechas */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Inicio *</label>
              <input type="datetime-local" className="input-base" value={form.starts_at} onChange={e => set('starts_at', e.target.value)} required />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Fin *</label>
              <input type="datetime-local" className="input-base" value={form.ends_at} onChange={e => set('ends_at', e.target.value)} required />
            </div>
          </div>

          {/* Virtual toggle */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => set('is_virtual', !form.is_virtual)}
              className={cn('relative inline-flex h-5 w-9 rounded-full transition-colors', form.is_virtual ? 'bg-violet-600' : 'bg-gray-200')}
            >
              <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform', form.is_virtual ? 'translate-x-4' : 'translate-x-0.5')} />
            </button>
            <span className="text-sm text-gray-700">Evento virtual</span>
          </div>

          {/* Ubicación o link virtual */}
          {form.is_virtual ? (
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Link de la reunión</label>
              <input className="input-base" value={form.virtual_link} onChange={e => set('virtual_link', e.target.value)} placeholder="https://meet.google.com/..." />
            </div>
          ) : (
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Ubicación</label>
              <input className="input-base" value={form.location} onChange={e => set('location', e.target.value)} placeholder="Dirección o lugar..." />
            </div>
          )}

          {/* Campaña — primero */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Campaña asociada</label>
            <select className="input-base" value={form.campaign_id} onChange={e => set('campaign_id', e.target.value)}>
              <option value="">— Sin campaña —</option>
              {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          {/* Influencers — multi-select */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">
              Influencers * <span className="text-gray-400 font-normal">({selectedInfluencers.length} seleccionadas)</span>
            </label>
            <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-xl divide-y divide-gray-50">
              {influencers.length === 0 && <p className="text-xs text-gray-400 p-3">Cargando…</p>}
              {influencers.map(inf => (
                <button key={inf.id} type="button"
                  onClick={() => { toggleInfluencer(inf.id); setFormError(null) }}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors text-left',
                    selectedInfluencers.includes(inf.id) ? 'bg-violet-50 text-violet-800' : 'hover:bg-gray-50 text-gray-700'
                  )}>
                  <span className={cn(
                    'w-4 h-4 rounded border-2 flex-shrink-0 flex items-center justify-center text-[10px]',
                    selectedInfluencers.includes(inf.id) ? 'border-violet-500 bg-violet-500 text-white' : 'border-gray-300'
                  )}>
                    {selectedInfluencers.includes(inf.id) ? '✓' : ''}
                  </span>
                  {inf.display_name}
                  {inf.email && <span className="text-xs text-gray-400 ml-auto">{inf.email}</span>}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-1">Recibirán email de confirmación con el booking</p>
          </div>

          {/* Fee */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-gray-600 mb-1">Tarifa</label>
              <input type="number" className="input-base" value={form.fee} onChange={e => set('fee', e.target.value)} placeholder="0.00" min="0" step="0.01" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Moneda</label>
              <select className="input-base" value={form.currency} onChange={e => set('currency', e.target.value)}>
                <option>USD</option>
                <option>MXN</option>
                <option>CLP</option>
                <option>EUR</option>
              </select>
            </div>
          </div>

          {/* Descripción */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Descripción</label>
            <textarea className="input-base resize-none" rows={2} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Brief o detalles del evento..." />
          </div>

          {/* Notas internas */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Notas internas</label>
            <textarea className="input-base resize-none" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Notas privadas del equipo..." />
          </div>

          {formError && (
            <p className="text-xs text-red-500 font-medium bg-red-50 rounded-lg px-3 py-2">{formError}</p>
          )}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2 text-sm font-semibold rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={sending || createBooking.isPending}
              className="flex-1 py-2 text-sm font-semibold rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-60 transition-colors flex items-center justify-center gap-2"
            >
              {createBooking.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Creando...</> : 'Crear booking'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Status config ──────────────────────────────────────
const STATUS_CONFIG: Record<BookingStatus, { label: string; color: string; dot: string }> = {
  proposed:  { label: 'Propuesto',   color: 'badge-orange', dot: 'bg-amber-400' },
  confirmed: { label: 'Confirmado',  color: 'badge-green',  dot: 'bg-emerald-500' },
  completed: { label: 'Completado',  color: 'badge-gray',   dot: 'bg-gray-400' },
  canceled:  { label: 'Cancelado',   color: 'badge-red',    dot: 'bg-red-400' },
  no_show:   { label: 'No se presentó', color: 'badge-red', dot: 'bg-red-600' },
}

const EVENT_COLORS: Record<string, string> = {
  shoot: 'bg-violet-100 text-violet-700 border-violet-200',
  event: 'bg-blue-100 text-blue-700 border-blue-200',
  live:  'bg-emerald-100 text-emerald-700 border-emerald-200',
  meeting: 'bg-amber-100 text-amber-700 border-amber-200',
}

type CalDeliverable = {
  id: string; title: string | null; type: string; status: string
  due_date: string
  campaign: { id: string; name: string } | null
  influencer: { id: string; display_name: string; avatar_url: string | null } | null
}

export function BookingsClient() {
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [view, setView] = useState<'month' | 'list'>('month')
  const [selected, setSelected] = useState<Booking | null>(null)
  const [showNewBooking, setShowNewBooking] = useState(false)
  const [deliverables, setDeliverables] = useState<CalDeliverable[]>([])

  const { data, isLoading, error: bookingsError, refetch: refetchBookings } = useBookings()
  const bookings = data?.data ?? []

  const updateStatus = useUpdateBookingStatus()
  const cancelMutation = useCancelBooking()

  // ── Fetch deliverables for current month ───────────
  useEffect(() => {
    const from = format(startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 }), 'yyyy-MM-dd')
    const to   = format(endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 1 }), 'yyyy-MM-dd')
    fetch(`/api/deliverables?from=${from}&to=${to}`)
      .then(r => r.json())
      .then(j => setDeliverables(j.data ?? []))
      .catch(() => {/* silent */})
  }, [currentMonth])

  // ── Calendar grid helpers ──────────────────────────
  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(currentMonth)
  const calStart = startOfWeek(monthStart, { weekStartsOn: 1 })
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 })
  const calDays = eachDayOfInterval({ start: calStart, end: calEnd })

  const bookingsForDay = useCallback((day: Date) =>
    bookings.filter(b => isSameDay(parseISO(b.starts_at), day))
  , [bookings])

  const deliverablesForDay = useCallback((day: Date) =>
    deliverables.filter(d => isSameDay(parseISO(d.due_date), day))
  , [deliverables])

  // ── Acciones ───────────────────────────────────────
  const confirmBooking = useCallback(async (booking: Booking) => {
    await updateStatus.mutateAsync({ id: booking.id, status: 'confirmed' })
  }, [updateStatus])

  const cancelBooking = useCallback(async (id: string) => {
    await cancelMutation.mutateAsync(id)
    setSelected(null)
  }, [cancelMutation])

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Bookings</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Sincronizado con Google Calendar
            <span className="inline-flex items-center gap-1 ml-2 text-emerald-600 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              En vivo
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Toggle view */}
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setView('month')}
              className={cn('p-1.5 rounded-md transition-all flex items-center gap-1.5 text-xs font-medium px-2',
                view === 'month' ? 'bg-white shadow-sm text-violet-600' : 'text-gray-400 hover:text-gray-600'
              )}
            >
              <CalendarDays className="h-3.5 w-3.5" /> Mes
            </button>
            <button
              onClick={() => setView('list')}
              className={cn('p-1.5 rounded-md transition-all flex items-center gap-1.5 text-xs font-medium px-2',
                view === 'list' ? 'bg-white shadow-sm text-violet-600' : 'text-gray-400 hover:text-gray-600'
              )}
            >
              <List className="h-3.5 w-3.5" /> Lista
            </button>
          </div>
          <button
            onClick={() => setShowNewBooking(true)}
            className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white text-sm font-semibold rounded-lg hover:bg-violet-700 transition-colors"
          >
            <Plus className="h-4 w-4" /> Nuevo booking
          </button>
        </div>
      </div>

      <div className="flex gap-5">
        {/* ── CALENDARIO / LISTA ─────────────────────── */}
        <div className="flex-1 min-w-0">

          {isLoading && (
            <div className="card p-8 text-center animate-pulse">
              <div className="h-4 bg-gray-100 rounded w-48 mx-auto mb-3" />
              <div className="h-3 bg-gray-100 rounded w-32 mx-auto" />
            </div>
          )}

          {bookingsError && !isLoading && (
            <div className="card p-8 text-center">
              <p className="text-red-500 text-sm">Error al cargar bookings. Intenta de nuevo.</p>
            </div>
          )}

          {/* Month nav */}
          <div className="card p-4 mb-4">
            <div className="flex items-center justify-between">
              <button
                onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <ChevronLeft className="h-5 w-5 text-gray-500" />
              </button>
              <h2 className="text-base font-semibold text-gray-900 capitalize">
                {format(currentMonth, 'MMMM yyyy', { locale: es })}
              </h2>
              <button
                onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <ChevronRight className="h-5 w-5 text-gray-500" />
              </button>
            </div>
          </div>

          {view === 'month' ? (
            <div className="card overflow-hidden">
              {/* Day headers */}
              <div className="grid grid-cols-7 border-b border-gray-100">
                {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(d => (
                  <div key={d} className="py-2 text-center text-xs font-semibold text-gray-400 bg-gray-50">
                    {d}
                  </div>
                ))}
              </div>

              {/* Days grid */}
              <div className="grid grid-cols-7">
                {calDays.map((day, idx) => {
                  const dayBookings     = bookingsForDay(day)
                  const dayDeliverables = deliverablesForDay(day)
                  const isCurrentMonth  = isSameMonth(day, currentMonth)
                  const todayDay        = isToday(day)
                  const totalItems      = dayBookings.length + dayDeliverables.length

                  return (
                    <div
                      key={idx}
                      className={cn(
                        'min-h-[100px] p-2 border-b border-r border-gray-50 transition-colors',
                        !isCurrentMonth && 'bg-gray-50/50',
                        idx % 7 === 6 && 'border-r-0',
                        Math.floor(idx / 7) === Math.floor((calDays.length - 1) / 7) && 'border-b-0',
                      )}
                    >
                      <div className={cn(
                        'w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium mb-1 mx-auto',
                        todayDay ? 'bg-violet-600 text-white font-bold' : '',
                        !isCurrentMonth ? 'text-gray-300' : 'text-gray-700',
                      )}>
                        {format(day, 'd')}
                      </div>

                      {/* Bookings */}
                      {dayBookings.slice(0, 2).map(b => (
                        <button
                          key={b.id}
                          onClick={() => setSelected(b)}
                          className={cn(
                            'w-full text-left text-[11px] font-medium px-1.5 py-0.5 rounded-md mb-0.5 border truncate transition-colors hover:opacity-80',
                            EVENT_COLORS[b.event_type ?? 'event'] ?? 'bg-gray-100 text-gray-600 border-gray-200'
                          )}
                        >
                          {format(parseISO(b.starts_at), 'HH:mm')} {b.title}
                        </button>
                      ))}

                      {/* Deliverables */}
                      {dayDeliverables.slice(0, dayBookings.length >= 2 ? 0 : 2 - dayBookings.length).map(d => (
                        <div
                          key={d.id}
                          title={`${d.influencer?.display_name ?? ''} · ${d.campaign?.name ?? ''}`}
                          className="w-full text-left text-[11px] font-medium px-1.5 py-0.5 rounded-md mb-0.5 border truncate bg-amber-50 text-amber-700 border-amber-200 flex items-center gap-1"
                        >
                          <FileText className="h-2.5 w-2.5 flex-shrink-0" />
                          <span className="truncate">
                            {format(parseISO(d.due_date), 'HH:mm')} {d.title ?? d.type}
                            {d.influencer && <span className="opacity-60"> · {d.influencer.display_name}</span>}
                          </span>
                        </div>
                      ))}

                      {totalItems > 2 && (
                        <div className="text-[10px] text-gray-400 pl-1">
                          +{totalItems - 2} más
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            /* Lista view */
            <div className="space-y-3">
              {bookings
                .sort((a, b) => parseISO(a.starts_at).getTime() - parseISO(b.starts_at).getTime())
                .map(b => {
                  const cfg = STATUS_CONFIG[b.status]
                  return (
                    <button
                      key={b.id}
                      onClick={() => setSelected(b)}
                      className="card w-full p-4 text-left hover:shadow-card-md hover:-translate-y-0.5 transition-all"
                    >
                      <div className="flex items-start gap-3">
                        <div className={cn(
                          'w-12 text-center flex-shrink-0 rounded-lg p-2',
                          EVENT_COLORS[b.event_type ?? 'event'] ?? 'bg-gray-100 text-gray-600'
                        )}>
                          <div className="text-lg font-bold leading-none">
                            {format(parseISO(b.starts_at), 'd')}
                          </div>
                          <div className="text-[10px] font-semibold uppercase mt-0.5">
                            {format(parseISO(b.starts_at), 'MMM', { locale: es })}
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-semibold text-gray-900 truncate">{b.title}</span>
                            <span className={`badge ${cfg.color} text-[10px] flex-shrink-0`}>{cfg.label}</span>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-gray-400">
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {format(parseISO(b.starts_at), 'HH:mm')}–{format(parseISO(b.ends_at), 'HH:mm')}
                            </span>
                            {b.influencer && (
                              <span>👤 {b.influencer.display_name}
                                {b.booking_influencers && b.booking_influencers.length > 1 &&
                                  <span className="text-gray-400"> +{b.booking_influencers.length - 1}</span>
                                }
                              </span>
                            )}
                            {b.is_virtual
                              ? <span className="flex items-center gap-1"><Video className="h-3 w-3" /> Virtual</span>
                              : b.location && (
                                <span className="flex items-center gap-1 truncate">
                                  <MapPin className="h-3 w-3 flex-shrink-0" />
                                  <span className="truncate">{b.location}</span>
                                </span>
                              )
                            }
                            {b.fee && (
                              <span className="ml-auto font-semibold text-gray-700">
                                {formatCurrency(b.fee, b.currency)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                  )
                })}
            </div>
          )}
        </div>

        {/* ── DETALLE LATERAL ──────────────────────── */}
        {selected && (
          <div className="w-80 flex-shrink-0 space-y-3 animate-slide-up">
            <div className="card p-4">
              {/* Header del detalle */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <div className={cn(
                    'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold mb-2 border',
                    EVENT_COLORS[selected.event_type ?? 'event']
                  )}>
                    {selected.event_type?.toUpperCase() ?? 'EVENTO'}
                  </div>
                  <h3 className="text-sm font-bold text-gray-900">{selected.title}</h3>
                </div>
                <button
                  onClick={() => setSelected(null)}
                  className="p-1 rounded-md hover:bg-gray-100 text-gray-400 flex-shrink-0 ml-2"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Status */}
              <div className="flex items-center gap-2 mb-4">
                <span className={`badge ${STATUS_CONFIG[selected.status].color}`}>
                  <span className={cn('w-1.5 h-1.5 rounded-full', STATUS_CONFIG[selected.status].dot)} />
                  {STATUS_CONFIG[selected.status].label}
                </span>
                {selected.google_calendar_link && (
                  <a
                    href={selected.google_calendar_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-blue-500 hover:underline"
                  >
                    <CalendarDays className="h-3 w-3" /> Google Cal
                  </a>
                )}
              </div>

              {/* Fecha y hora */}
              <div className="space-y-2 mb-4 text-xs">
                <div className="flex items-center gap-2 text-gray-600">
                  <Clock className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                  <div>
                    <div className="font-semibold capitalize">
                      {format(parseISO(selected.starts_at), "EEEE d 'de' MMMM yyyy", { locale: es })}
                    </div>
                    <div className="text-gray-400">
                      {format(parseISO(selected.starts_at), 'HH:mm')} –{' '}
                      {format(parseISO(selected.ends_at), 'HH:mm')}
                    </div>
                  </div>
                </div>

                {/* Influencers */}
                {selected.booking_influencers && selected.booking_influencers.length > 0 ? (
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Influencers ({selected.booking_influencers.length})</p>
                    {selected.booking_influencers.map(bi => (
                      <div key={bi.id} className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-gray-700 text-sm">
                          <span>👤</span>
                          <span>{bi.influencer?.display_name ?? 'Influencer'}</span>
                        </div>
                        <select
                          value={bi.status}
                          onChange={async e => {
                            await fetch(`/api/bookings/influencers/${bi.id}`, {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ status: e.target.value }),
                            })
                            refetchBookings()
                          }}
                          className={`text-[11px] font-semibold rounded-full px-2 py-0.5 border-0 outline-none cursor-pointer ${
                            bi.status === 'confirmed' || bi.status === 'attended'
                              ? 'bg-emerald-100 text-emerald-700'
                              : bi.status === 'declined' || bi.status === 'no_show'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-amber-100 text-amber-700'
                          }`}
                        >
                          <option value="invited">Invitado</option>
                          <option value="confirmed">Confirmado</option>
                          <option value="declined">Declinó</option>
                          <option value="attended">Asistió</option>
                          <option value="no_show">No asistió</option>
                        </select>
                      </div>
                    ))}
                  </div>
                ) : selected.influencer ? (
                  <div className="flex items-center gap-2 text-gray-600">
                    <span className="text-gray-400">👤</span>
                    <span>{selected.influencer.display_name}</span>
                  </div>
                ) : null}

                {/* Campaña */}
                {selected.campaign && (
                  <div className="flex items-center gap-2 text-gray-600">
                    <span className="text-gray-400">🎯</span>
                    <span>{selected.campaign.name}</span>
                  </div>
                )}

                {/* Fee */}
                {selected.fee && (
                  <div className="flex items-center gap-2 text-gray-600">
                    <span className="text-gray-400">💰</span>
                    <span className="font-semibold">{formatCurrency(selected.fee, selected.currency)}</span>
                    {selected.travel_covered && (
                      <span className="badge badge-green text-[10px]">+ viáticos</span>
                    )}
                  </div>
                )}
              </div>

              {/* Ubicación + Mapa */}
              {selected.is_virtual ? (
                <div className="bg-emerald-50 rounded-lg p-3 mb-4">
                  <div className="flex items-center gap-2 text-emerald-700 text-xs font-medium mb-1">
                    <Video className="h-3.5 w-3.5" /> Evento virtual
                  </div>
                  {selected.virtual_link && (
                    <a
                      href={selected.virtual_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-emerald-600 hover:underline flex items-center gap-1"
                    >
                      <ExternalLink className="h-3 w-3" />
                      {selected.virtual_link}
                    </a>
                  )}
                </div>
              ) : selected.location ? (
                <div className="mb-4">
                  <AddressWithMap
                    address={selected.location}
                    label="Ubicación"
                    showMap={true}
                  />
                </div>
              ) : null}

              {/* Notas */}
              {selected.description && (
                <div className="mb-4">
                  <div className="text-xs font-medium text-gray-500 mb-1">Descripción</div>
                  <p className="text-xs text-gray-600 leading-relaxed">{selected.description}</p>
                </div>
              )}
              {selected.notes && (
                <div className="mb-4">
                  <div className="text-xs font-medium text-gray-500 mb-1">Notas internas</div>
                  <p className="text-xs text-gray-600 leading-relaxed bg-amber-50 rounded-lg p-2">{selected.notes}</p>
                </div>
              )}

              {/* Acciones */}
              <div className="space-y-2">
                {selected.status === 'proposed' && (
                  <button
                    onClick={() => confirmBooking(selected)}
                    className="w-full flex items-center justify-center gap-2 py-2 bg-violet-600 text-white text-xs font-semibold rounded-lg hover:bg-violet-700 transition-colors"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" /> Confirmar booking
                  </button>
                )}
                {selected.google_calendar_link && (
                  <a
                    href={selected.google_calendar_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full flex items-center justify-center gap-2 py-2 bg-white border border-gray-200 text-gray-700 text-xs font-semibold rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <CalendarDays className="h-3.5 w-3.5 text-blue-500" /> Ver en Google Calendar
                  </a>
                )}
                {selected.status !== 'canceled' && selected.status !== 'completed' && (
                  <button
                    onClick={() => cancelBooking(selected.id)}
                    className="w-full flex items-center justify-center gap-2 py-2 bg-white border border-red-100 text-red-500 text-xs font-semibold rounded-lg hover:bg-red-50 transition-colors"
                  >
                    <X className="h-3.5 w-3.5" /> Cancelar booking
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {showNewBooking && <NewBookingModal onClose={() => setShowNewBooking(false)} />}
    </div>
  )
}
