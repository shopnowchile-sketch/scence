'use client'

import { useEffect, useState, useCallback } from 'react'
import { Calendar, MapPin, Briefcase, Building2, RefreshCw, Clock, CheckCircle2, XCircle, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

type Booking = {
  id: string
  title: string | null
  description: string | null
  status: string
  my_status: string
  starts_at: string | null
  ends_at: string | null
  location: string | null
  campaign: { id: string; name: string } | null
  brand: { id: string; name: string; logo_url: string | null } | null
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  confirmed:  { label: 'Confirmado',  color: 'bg-green-100 text-green-700',  icon: CheckCircle2 },
  pending:    { label: 'Pendiente',   color: 'bg-amber-100 text-amber-700',  icon: Clock },
  canceled:   { label: 'Cancelado',   color: 'bg-gray-100 text-gray-500',    icon: XCircle },
  completed:  { label: 'Completado',  color: 'bg-violet-100 text-violet-700', icon: CheckCircle2 },
}

function fmt(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function fmtShort(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' })
}

export default function InfluencerBookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading,  setLoading]  = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch('/api/influencer/bookings')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setBookings(json.data ?? [])
    } catch (e) {
      toast.error((e as Error).message ?? 'Error cargando bookings')
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function checkIn(bookingId: string) {
    try {
      const res  = await fetch('/api/influencer/bookings/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booking_id: bookingId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, status: 'confirmed', my_status: 'confirmed' } : b))
      toast.success('Check-in realizado')
    } catch (e) {
      toast.error((e as Error).message ?? 'Error en check-in')
    }
  }

  const upcoming = bookings.filter(b => b.status !== 'canceled' && b.status !== 'completed' && new Date(b.starts_at ?? 0) >= new Date())
  const past     = bookings.filter(b => b.status === 'completed' || new Date(b.starts_at ?? 0) < new Date())

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

      {bookings.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 flex flex-col items-center py-20 gap-3">
          <Calendar className="h-10 w-10 text-gray-200" />
          <p className="text-sm font-semibold text-gray-400">Sin bookings asignados</p>
          <p className="text-xs text-gray-400">Tu agencia te asignará eventos y participaciones aquí.</p>
        </div>
      ) : (
        <div className="space-y-6">

          {/* Próximos */}
          {upcoming.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Próximos ({upcoming.length})</p>
              <div className="space-y-3">
                {upcoming.map(b => <BookingCard key={b.id} booking={b} onCheckIn={checkIn} />)}
              </div>
            </div>
          )}

          {/* Pasados */}
          {past.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Historial ({past.length})</p>
              <div className="space-y-3">
                {past.map(b => <BookingCard key={b.id} booking={b} onCheckIn={checkIn} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function BookingCard({ booking: b, onCheckIn }: { booking: Booking; onCheckIn: (id: string) => void }) {
  const cfg   = STATUS_CONFIG[b.my_status ?? b.status] ?? STATUS_CONFIG.pending
  const Icon  = cfg.icon
  const isUpcoming = new Date(b.starts_at ?? 0) >= new Date()
  const canCheckIn = isUpcoming && b.my_status === 'pending'

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
            <h3 className="text-sm font-bold text-gray-900">{b.title ?? 'Sin título'}</h3>
            <span className={cn('text-[10px] font-bold px-2 py-1 rounded-full flex items-center gap-1 flex-shrink-0', cfg.color)}>
              <Icon className="h-3 w-3" /> {cfg.label}
            </span>
          </div>

          <div className="mt-1.5 space-y-1">
            {b.starts_at && (
              <div className="flex items-center gap-1.5 text-xs text-gray-500">
                <Clock className="h-3 w-3 flex-shrink-0" />
                {fmt(b.starts_at)}{b.ends_at && b.ends_at !== b.starts_at ? ` → ${fmtShort(b.ends_at)}` : ''}
              </div>
            )}
            {b.location && (
              <div className="flex items-center gap-1.5 text-xs text-gray-500">
                <MapPin className="h-3 w-3 flex-shrink-0" />
                {b.location}
              </div>
            )}
            {b.campaign && (
              <div className="flex items-center gap-1.5 text-xs text-gray-500">
                <Briefcase className="h-3 w-3 flex-shrink-0" />
                {b.campaign.name}
              </div>
            )}
            {b.brand && (
              <div className="flex items-center gap-1.5 text-xs text-gray-500">
                <Building2 className="h-3 w-3 flex-shrink-0" />
                {b.brand.name}
              </div>
            )}
          </div>

          {b.description && (
            <p className="mt-2 text-xs text-gray-400 line-clamp-2">{b.description}</p>
          )}

          {canCheckIn && (
            <button
              onClick={() => onCheckIn(b.id)}
              className="mt-3 flex items-center gap-1.5 text-xs font-semibold bg-violet-600 text-white px-3 py-1.5 rounded-lg hover:bg-violet-700 transition-colors"
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> Confirmar asistencia
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
