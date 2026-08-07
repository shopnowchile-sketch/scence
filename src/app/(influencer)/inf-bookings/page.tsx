'use client'

import { useEffect, useState, useCallback } from 'react'
import { Calendar, MapPin, RefreshCw, Clock } from 'lucide-react'
import { toast } from 'sonner'

type Booking = {
  id: string
  title: string | null
  status: string
  starts_at: string | null
  ends_at: string | null
  location: string | null
  campaign: { id: string; name: string } | null
}

type CampaignEvent = {
  id: string
  name: string
  event_date: string
  location: string | null
  is_virtual: boolean
  status: string
}

function fmt(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function InfluencerBookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [events,   setEvents]   = useState<CampaignEvent[]>([])
  const [loading,  setLoading]  = useState(true)
  // Historial sin límite crecía indefinidamente sin forma de acotarlo —
  // se muestran los últimos 10 por default, con opción de ver todo.
  const [showAllPast, setShowAllPast] = useState(false)
  const PAST_PAGE_SIZE = 10

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [res, evtRes] = await Promise.all([
        fetch('/api/influencer/bookings'),
        fetch('/api/influencer/events'),
      ])
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setBookings(json.data ?? [])
      setEvents(evtRes.ok ? (await evtRes.json()).events ?? [] : [])
    } catch (e) {
      toast.error((e as Error).message ?? 'Error cargando bookings')
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const upcoming = bookings.filter(b => b.status !== 'canceled' && b.status !== 'completed' && new Date(b.starts_at ?? 0) >= new Date())
  const pastAll  = bookings
    .filter(b => b.status === 'completed' || new Date(b.starts_at ?? 0) < new Date())
    .sort((a, b) => new Date(b.starts_at ?? 0).getTime() - new Date(a.starts_at ?? 0).getTime())
  const past     = showAllPast ? pastAll : pastAll.slice(0, PAST_PAGE_SIZE)

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-10 h-10 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Mis Bookings</h1>
          <p className="text-sm text-gray-400 mt-0.5">Eventos y participaciones agendadas</p>
        </div>
        <button onClick={load} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {bookings.length === 0 && events.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 flex flex-col items-center py-20 gap-3">
          <Calendar className="h-10 w-10 text-gray-200" />
          <p className="text-sm font-semibold text-gray-400">Sin bookings ni eventos asignados</p>
          <p className="text-xs text-gray-400">Tu agencia te asignará eventos y participaciones aquí.</p>
        </div>
      ) : (
        <div className="space-y-6">

          {/* Eventos de campaña */}
          {events.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Eventos ({events.length})</p>
              <div className="space-y-3">
                {events.map(e => <EventCard key={e.id} event={e} />)}
              </div>
            </div>
          )}

          {/* Próximos */}
          {upcoming.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Próximos ({upcoming.length})</p>
              <div className="space-y-3">
                {upcoming.map(b => <BookingCard key={b.id} booking={b} />)}
              </div>
            </div>
          )}

          {/* Pasados */}
          {past.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Historial ({showAllPast ? pastAll.length : `${past.length} de ${pastAll.length}`})
              </p>
              <div className="space-y-3">
                {past.map(b => <BookingCard key={b.id} booking={b} />)}
              </div>
              {!showAllPast && pastAll.length > PAST_PAGE_SIZE && (
                <button
                  onClick={() => setShowAllPast(true)}
                  className="mt-3 w-full text-center text-xs font-semibold text-violet-600 hover:text-violet-700 py-2"
                >
                  Ver todo el historial ({pastAll.length})
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function BookingCard({ booking: b }: { booking: Booking }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5">
      <div className="flex items-start gap-4">

        {/* Fecha */}
        <div className="flex-shrink-0 w-12 text-center">
          <div className="bg-violet-50 rounded-xl px-2 py-2">
            <p className="text-xs text-violet-400 font-semibold uppercase leading-none">
              {b.starts_at ? new Date(b.starts_at).toLocaleDateString('es-CL', { month: 'short' }) : '—'}
            </p>
            <p className="text-2xl font-extrabold text-violet-700 leading-tight">
              {b.starts_at ? new Date(b.starts_at).getDate() : '—'}
            </p>
          </div>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-bold text-gray-900">{b.campaign?.name ?? b.title ?? 'Evento'}</h3>
          </div>

          <div className="mt-1.5 space-y-1">
            {b.starts_at && (
              <div className="flex items-center gap-1.5 text-xs text-gray-500">
                <Clock className="h-3 w-3 flex-shrink-0" />
                {fmt(b.starts_at)}{b.ends_at && b.ends_at !== b.starts_at ? ` – ${new Date(b.ends_at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}` : ''}
              </div>
            )}
            {b.location && (
              <div className="flex items-center gap-1.5 text-xs text-gray-500">
                <MapPin className="h-3 w-3 flex-shrink-0" />
                {b.location}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function EventCard({ event: e }: { event: CampaignEvent }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5">
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0 w-12 text-center">
          <div className="bg-blue-50 rounded-xl px-2 py-2">
            <p className="text-xs text-blue-400 font-semibold uppercase leading-none">
              {new Date(e.event_date).toLocaleDateString('es-CL', { month: 'short' })}
            </p>
            <p className="text-2xl font-extrabold text-blue-700 leading-tight">
              {new Date(e.event_date).getDate()}
            </p>
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-bold text-gray-900">{e.name}</h3>
            <span className="text-[10px] font-bold px-2 py-1 rounded-full flex-shrink-0 bg-blue-100 text-blue-700">
              Evento
            </span>
          </div>
          <div className="mt-1.5 space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <Clock className="h-3 w-3 flex-shrink-0" />
              {fmt(e.event_date)}
            </div>
            {e.location && (
              <div className="flex items-center gap-1.5 text-xs text-gray-500">
                <MapPin className="h-3 w-3 flex-shrink-0" />
                {e.is_virtual ? 'Virtual' : e.location}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
