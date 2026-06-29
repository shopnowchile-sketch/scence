'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, CalendarDays, MapPin, Wifi, Users, Ticket,
  DollarSign, Plus, Loader2, AlertCircle, X, CheckCircle2,
  BarChart3, ExternalLink, Globe,
} from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────
type EventStatus = 'draft' | 'published' | 'canceled' | 'completed'
type SaleStatus  = 'pending' | 'confirmed' | 'canceled' | 'refunded'

interface TicketType {
  id: string
  name: string
  description: string | null
  price: number
  currency: string
  quantity_total: number
  quantity_sold: number
  created_at: string
}

interface Sale {
  id: string
  buyer_name: string
  buyer_email: string
  buyer_phone: string | null
  quantity: number
  unit_price: number
  total_amount: number
  currency: string
  status: SaleStatus
  payment_method: string | null
  notes: string | null
  created_at: string
  ticket_type_id: string
  event_ticket_types?: { id: string; name: string; price: number; currency: string } | null
}

interface EventDetail {
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
  organization_id: string
  created_at: string
  updated_at: string | null
  event_ticket_types: TicketType[]
  recent_sales: Sale[]
  campaigns?: { id: string; name: string; status: string } | null
}

// ── Status config ─────────────────────────────────────────────────────────────
const STATUS_CFG: Record<EventStatus, { label: string; cls: string }> = {
  draft:     { label: 'Borrador',   cls: 'badge-gray' },
  published: { label: 'Publicado',  cls: 'badge-green' },
  canceled:  { label: 'Cancelado',  cls: 'badge-red' },
  completed: { label: 'Completado', cls: 'badge-blue' },
}

const SALE_STATUS_CFG: Record<SaleStatus, { label: string; cls: string }> = {
  pending:   { label: 'Pendiente',  cls: 'badge-orange' },
  confirmed: { label: 'Confirmada', cls: 'badge-green' },
  canceled:  { label: 'Cancelada',  cls: 'badge-red' },
  refunded:  { label: 'Reembolsada',cls: 'badge-gray' },
}

function fmtDate(d: string) {
  try { return format(parseISO(d), "d MMM yyyy, HH:mm", { locale: es }) } catch { return d }
}
function fmtShort(d: string) {
  try { return format(parseISO(d), "d MMM yyyy", { locale: es }) } catch { return d }
}
function fmtMoney(amount: number, currency = 'CLP') {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount)
}

type Tab = 'overview' | 'tickets' | 'sales'

// ── Add Ticket Type Modal ─────────────────────────────────────────────────────
function AddTicketTypeModal({
  eventId,
  onClose,
  onCreated,
}: {
  eventId: string
  onClose: () => void
  onCreated: (tt: TicketType) => void
}) {
  const [form, setForm] = useState({ name: '', description: '', price: '', currency: 'CLP', quantity_total: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!form.name.trim())        { setError('El nombre es requerido'); return }
    if (form.price === '')        { setError('El precio es requerido'); return }
    if (!form.quantity_total)     { setError('La cantidad es requerida'); return }

    setSaving(true)
    try {
      const res  = await fetch(`/api/events/${eventId}/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description || null,
          price: Number(form.price),
          currency: form.currency,
          quantity_total: Number(form.quantity_total),
        }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Error al crear tipo de entrada'); return }
      toast.success('Tipo de entrada creado')
      onCreated(json.data)
      onClose()
    } catch {
      setError('Error de red')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">Nuevo tipo de entrada</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
              <AlertCircle className="h-4 w-4 flex-shrink-0" /> {error}
            </div>
          )}
          <div>
            <label className="label">Nombre *</label>
            <input className="input-base" placeholder="Ej: Entrada General" value={form.name} onChange={e => set('name', e.target.value)} />
          </div>
          <div>
            <label className="label">Descripción</label>
            <input className="input-base" placeholder="Ej: Acceso área general" value={form.description} onChange={e => set('description', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Precio *</label>
              <input type="number" min="0" step="1" className="input-base" placeholder="15000" value={form.price} onChange={e => set('price', e.target.value)} />
            </div>
            <div>
              <label className="label">Moneda</label>
              <select className="input-base" value={form.currency} onChange={e => set('currency', e.target.value)}>
                {['CLP','USD','EUR','MXN','COP','ARS','BRL'].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Cantidad disponible *</label>
            <input type="number" min="1" className="input-base" placeholder="100" value={form.quantity_total} onChange={e => set('quantity_total', e.target.value)} />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">Cancelar</button>
            <button type="submit" disabled={saving} className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold text-white bg-violet-600 rounded-lg hover:bg-violet-700 disabled:opacity-50 transition-colors">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {saving ? 'Guardando…' : 'Crear'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Register Sale Modal ───────────────────────────────────────────────────────
function RegisterSaleModal({
  eventId,
  ticketTypes,
  onClose,
  onCreated,
}: {
  eventId: string
  ticketTypes: TicketType[]
  onClose: () => void
  onCreated: (sale: Sale) => void
}) {
  const [form, setForm] = useState({
    ticket_type_id: ticketTypes[0]?.id ?? '',
    buyer_name: '',
    buyer_email: '',
    buyer_phone: '',
    quantity: '1',
    payment_method: 'efectivo',
    notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const selectedType = ticketTypes.find(t => t.id === form.ticket_type_id)
  const total = selectedType ? selectedType.price * Number(form.quantity || 1) : 0

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!form.ticket_type_id) { setError('Selecciona un tipo de entrada'); return }
    if (!form.buyer_name.trim()) { setError('El nombre del comprador es requerido'); return }
    if (!form.buyer_email.trim()) { setError('El email del comprador es requerido'); return }

    setSaving(true)
    try {
      const res = await fetch(`/api/events/${eventId}/sales`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticket_type_id: form.ticket_type_id,
          buyer_name: form.buyer_name.trim(),
          buyer_email: form.buyer_email.trim(),
          buyer_phone: form.buyer_phone || null,
          quantity: Number(form.quantity),
          payment_method: form.payment_method,
          notes: form.notes || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Error al registrar venta'); return }
      toast.success('Venta registrada')
      onCreated(json.data)
      onClose()
    } catch {
      setError('Error de red')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">Registrar venta manual</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
              <AlertCircle className="h-4 w-4 flex-shrink-0" /> {error}
            </div>
          )}

          <div>
            <label className="label">Tipo de entrada *</label>
            <select className="input-base" value={form.ticket_type_id} onChange={e => set('ticket_type_id', e.target.value)}>
              <option value="">Seleccionar…</option>
              {ticketTypes.map(t => (
                <option key={t.id} value={t.id}>
                  {t.name} — {fmtMoney(t.price, t.currency)} ({t.quantity_total - t.quantity_sold} disp.)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">Nombre del comprador *</label>
            <input className="input-base" placeholder="Juan Pérez" value={form.buyer_name} onChange={e => set('buyer_name', e.target.value)} />
          </div>

          <div>
            <label className="label">Email *</label>
            <input type="email" className="input-base" placeholder="juan@email.com" value={form.buyer_email} onChange={e => set('buyer_email', e.target.value)} />
          </div>

          <div>
            <label className="label">Teléfono</label>
            <input className="input-base" placeholder="+56 9 1234 5678" value={form.buyer_phone} onChange={e => set('buyer_phone', e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Cantidad *</label>
              <input type="number" min="1" className="input-base" value={form.quantity} onChange={e => set('quantity', e.target.value)} />
            </div>
            <div>
              <label className="label">Método de pago</label>
              <select className="input-base" value={form.payment_method} onChange={e => set('payment_method', e.target.value)}>
                {['efectivo', 'transferencia', 'tarjeta', 'webpay', 'mercadopago', 'otro'].map(m => (
                  <option key={m} value={m} className="capitalize">{m.charAt(0).toUpperCase() + m.slice(1)}</option>
                ))}
              </select>
            </div>
          </div>

          {total > 0 && selectedType && (
            <div className="bg-violet-50 rounded-xl p-3 flex items-center justify-between">
              <span className="text-sm text-violet-700 font-medium">Total a cobrar</span>
              <span className="text-lg font-bold text-violet-800">{fmtMoney(total, selectedType.currency)}</span>
            </div>
          )}

          <div>
            <label className="label">Notas</label>
            <input className="input-base" placeholder="Notas opcionales…" value={form.notes} onChange={e => set('notes', e.target.value)} />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">Cancelar</button>
            <button type="submit" disabled={saving} className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold text-white bg-violet-600 rounded-lg hover:bg-violet-700 disabled:opacity-50 transition-colors">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {saving ? 'Guardando…' : 'Registrar venta'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [event, setEvent]     = useState<EventDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [tab, setTab]         = useState<Tab>('overview')
  const [sales, setSales]     = useState<Sale[]>([])
  const [salesLoading, setSalesLoading] = useState(false)
  const [showAddTicket, setShowAddTicket] = useState(false)
  const [showRegSale, setShowRegSale]     = useState(false)
  const [patchPending, setPatchPending]   = useState(false)

  const loadEvent = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res  = await fetch(`/api/events/${id}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Error al cargar evento')
      setEvent(json.data)
      setSales(json.data.recent_sales ?? [])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setLoading(false)
    }
  }, [id])

  const loadSales = useCallback(async () => {
    setSalesLoading(true)
    try {
      const res  = await fetch(`/api/events/${id}/sales`)
      const json = await res.json()
      if (res.ok) setSales(json.data ?? [])
    } finally {
      setSalesLoading(false)
    }
  }, [id])

  useEffect(() => { loadEvent() }, [loadEvent])

  useEffect(() => {
    if (tab === 'sales') loadSales()
  }, [tab, loadSales])

  async function handlePatch(fields: Record<string, unknown>) {
    if (!event) return
    setPatchPending(true)
    try {
      const res  = await fetch(`/api/events/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      })
      const json = await res.json()
      if (!res.ok) { toast.error(json.error ?? 'Error al actualizar'); return }
      setEvent(prev => prev ? { ...prev, ...json.data } : prev)
      toast.success('Evento actualizado')
    } catch {
      toast.error('Error de red')
    } finally {
      setPatchPending(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 text-violet-400 animate-spin" />
      </div>
    )
  }

  if (error || !event) {
    return (
      <div className="card p-12 text-center max-w-lg mx-auto mt-12">
        <AlertCircle className="h-10 w-10 text-red-300 mx-auto mb-3" />
        <p className="text-gray-500 font-medium">{error ?? 'Evento no encontrado'}</p>
        <Link href="/events" className="mt-4 inline-block text-sm text-violet-600 hover:underline">
          Volver a eventos
        </Link>
      </div>
    )
  }

  const ticketTypes = event.event_ticket_types ?? []
  const cfg         = STATUS_CFG[event.status] ?? STATUS_CFG.draft
  const cap         = event.capacity ?? 0
  const sold        = ticketTypes.reduce((s, t) => s + (t.quantity_sold ?? 0), 0)
  const pct         = cap > 0 ? Math.min(Math.round((sold / cap) * 100), 100) : 0
  const revenue     = sales
    .filter(s => s.status === 'confirmed')
    .reduce((s, sale) => s + (sale.total_amount ?? 0), 0)
  const available   = cap - sold

  const TABS = [
    { id: 'overview' as Tab, label: 'Overview',            icon: <BarChart3 className="h-4 w-4" /> },
    { id: 'tickets'  as Tab, label: `Tipos de entrada (${ticketTypes.length})`, icon: <Ticket className="h-4 w-4" /> },
    { id: 'sales'    as Tab, label: 'Ventas',              icon: <DollarSign className="h-4 w-4" /> },
  ]

  return (
    <div className="space-y-5">
      {/* Breadcrumb + actions */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link href="/events" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
            <ArrowLeft className="h-4 w-4" /> Eventos
          </Link>
          <span className="text-gray-200">/</span>
          <span className="text-sm font-semibold text-gray-800 truncate max-w-[240px]">{event.name}</span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {event.status === 'draft' && (
            <button
              onClick={() => handlePatch({ status: 'published' })}
              disabled={patchPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-white bg-violet-600 rounded-lg hover:bg-violet-700 disabled:opacity-50 transition-colors"
            >
              {patchPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Globe className="h-3.5 w-3.5" />}
              Publicar
            </button>
          )}
          {event.status === 'published' && (
            <button
              onClick={() => handlePatch({ status: 'completed' })}
              disabled={patchPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-50 transition-colors"
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> Marcar completado
            </button>
          )}
          {(event.status === 'draft' || event.status === 'published') && (
            <button
              onClick={() => { if (confirm('¿Cancelar este evento?')) handlePatch({ status: 'canceled' }) }}
              disabled={patchPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50 transition-colors"
            >
              <X className="h-3.5 w-3.5" /> Cancelar evento
            </button>
          )}
        </div>
      </div>

      {/* Header card */}
      <div className="card p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-violet-100 flex items-center justify-center flex-shrink-0">
            <CalendarDays className="h-6 w-6 text-violet-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap mb-1">
              <h1 className="text-xl font-bold text-gray-900 tracking-tight">{event.name}</h1>
              <span className={cn('badge', cfg.cls)}>{cfg.label}</span>
              {event.is_virtual && (
                <span className="badge badge-purple flex items-center gap-1">
                  <Wifi className="h-3 w-3" /> Virtual
                </span>
              )}
            </div>
            <div className="flex items-center gap-5 flex-wrap text-sm text-gray-500 mt-2">
              <div className="flex items-center gap-1.5">
                <CalendarDays className="h-4 w-4 text-gray-300" />
                <span>{fmtDate(event.event_date)}</span>
              </div>
              {event.location && (
                <div className="flex items-center gap-1.5">
                  <MapPin className="h-4 w-4 text-gray-300" />
                  <span>{event.location}</span>
                </div>
              )}
              {event.virtual_link && (
                <a href={event.virtual_link} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 text-violet-600 hover:underline">
                  <ExternalLink className="h-4 w-4" /> Ver link
                </a>
              )}
              {event.campaigns && (
                <Link href={`/campaigns/${event.campaign_id}`}
                  className="flex items-center gap-1 text-violet-600 hover:underline">
                  Campaña: {event.campaigns.name}
                </Link>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 flex-shrink-0">
            <div className="text-center bg-gray-50 rounded-xl p-3 min-w-[76px]">
              <div className="text-2xl font-bold text-gray-900">{sold}</div>
              <div className="text-[11px] text-gray-400">Vendidas</div>
            </div>
            <div className="text-center bg-gray-50 rounded-xl p-3 min-w-[76px]">
              <div className="text-2xl font-bold text-gray-900">{pct}%</div>
              <div className="text-[11px] text-gray-400">Ocupación</div>
            </div>
          </div>
        </div>

        {cap > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <div className="flex justify-between text-xs text-gray-400 mb-1.5">
              <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {sold}/{cap} entradas vendidas</span>
              <span>{pct}% ocupación</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-all',
                  pct >= 100 ? 'bg-red-400' : pct > 70 ? 'bg-amber-400' : 'bg-violet-500'
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <div className="flex gap-1">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-all -mb-px',
                tab === t.id
                  ? 'border-violet-600 text-violet-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              )}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── OVERVIEW ──────────────────────────────────────────────────────── */}
      {tab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 space-y-4">
            {event.description && (
              <div className="card p-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Descripción</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{event.description}</p>
              </div>
            )}

            <div className="card p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-violet-500" /> Estadísticas
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'Capacidad',    value: cap > 0 ? String(cap) : '—' },
                  { label: 'Vendidas',     value: String(sold) },
                  { label: 'Revenue',      value: revenue > 0 ? fmtMoney(revenue) : '—' },
                  { label: 'Disponibles',  value: cap > 0 ? String(Math.max(available, 0)) : '—' },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-gray-50 rounded-xl p-3 text-center">
                    <div className="text-xl font-bold text-gray-900">{value}</div>
                    <div className="text-[11px] text-gray-400 mt-0.5">{label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Detalles</h3>
              <div className="space-y-2.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Creado</span>
                  <span className="text-gray-700 font-medium">{fmtShort(event.created_at)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Tipos entrada</span>
                  <span className="text-gray-700 font-medium">{ticketTypes.length}</span>
                </div>
                {event.campaigns && (
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400">Campaña</span>
                    <Link href={`/campaigns/${event.campaign_id}`} className="text-violet-600 hover:underline text-xs font-medium truncate max-w-[140px]">
                      {event.campaigns.name}
                    </Link>
                  </div>
                )}
              </div>
            </div>

            <div className="card p-4 space-y-2">
              <h3 className="text-sm font-semibold text-gray-700 mb-1">Acciones rápidas</h3>
              <button
                onClick={() => setShowAddTicket(true)}
                className="block w-full px-3 py-2 rounded-lg text-sm font-medium transition-colors text-violet-700 bg-violet-50 hover:bg-violet-100 text-left"
              >
                + Agregar tipo de entrada
              </button>
              <button
                onClick={() => { setTab('sales'); setShowRegSale(true) }}
                className="block w-full px-3 py-2 rounded-lg text-sm font-medium transition-colors text-gray-700 bg-gray-50 hover:bg-gray-100 text-left"
              >
                + Registrar venta manual
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── TICKET TYPES ──────────────────────────────────────────────────── */}
      {tab === 'tickets' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">{ticketTypes.length} tipo{ticketTypes.length !== 1 ? 's' : ''} de entrada</p>
            <button
              onClick={() => setShowAddTicket(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-white bg-violet-600 rounded-lg hover:bg-violet-700 transition-colors"
            >
              <Plus className="h-4 w-4" /> Agregar tipo
            </button>
          </div>

          {ticketTypes.length === 0 ? (
            <div className="card p-12 text-center">
              <Ticket className="h-10 w-10 text-gray-200 mx-auto mb-3" />
              <p className="text-sm text-gray-400 mb-3">No hay tipos de entrada configurados</p>
              <button
                onClick={() => setShowAddTicket(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 text-white text-sm font-semibold rounded-lg hover:bg-violet-700 transition-colors"
              >
                <Plus className="h-4 w-4" /> Crear primer tipo
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {ticketTypes.map(tt => {
                const ttPct = tt.quantity_total > 0
                  ? Math.min(Math.round((tt.quantity_sold / tt.quantity_total) * 100), 100)
                  : 0
                return (
                  <div key={tt.id} className="card p-5">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="text-sm font-bold text-gray-900">{tt.name}</div>
                        {tt.description && <div className="text-xs text-gray-400 mt-0.5">{tt.description}</div>}
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-bold text-violet-700">{fmtMoney(tt.price, tt.currency)}</div>
                        <div className="text-[11px] text-gray-400">{tt.currency}</div>
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-xs text-gray-400 mb-1">
                        <span>{tt.quantity_sold} vendidas</span>
                        <span>{tt.quantity_total - tt.quantity_sold} disponibles</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={cn('h-full rounded-full',
                            ttPct >= 100 ? 'bg-red-400' : ttPct > 70 ? 'bg-amber-400' : 'bg-violet-500'
                          )}
                          style={{ width: `${ttPct}%` }}
                        />
                      </div>
                      <div className="text-[10px] text-gray-400 mt-1 text-right">{ttPct}% vendido</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── SALES ─────────────────────────────────────────────────────────── */}
      {tab === 'sales' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">
              {salesLoading ? 'Cargando…' : `${sales.length} venta${sales.length !== 1 ? 's' : ''}`}
            </p>
            <button
              onClick={() => setShowRegSale(true)}
              disabled={ticketTypes.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-white bg-violet-600 rounded-lg hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title={ticketTypes.length === 0 ? 'Primero crea un tipo de entrada' : ''}
            >
              <Plus className="h-4 w-4" /> Registrar venta manual
            </button>
          </div>

          {salesLoading ? (
            <div className="card p-8 text-center">
              <Loader2 className="h-6 w-6 text-violet-400 animate-spin mx-auto" />
            </div>
          ) : sales.length === 0 ? (
            <div className="card p-12 text-center">
              <DollarSign className="h-10 w-10 text-gray-200 mx-auto mb-3" />
              <p className="text-sm text-gray-400">Sin ventas registradas</p>
            </div>
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    {['Comprador', 'Tipo de entrada', 'Cant.', 'Total', 'Método', 'Estado', 'Fecha'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider bg-gray-50">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {sales.map(sale => {
                    const sc = SALE_STATUS_CFG[sale.status] ?? SALE_STATUS_CFG.pending
                    return (
                      <tr key={sale.id} className="hover:bg-gray-50/70 transition-colors">
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">{sale.buyer_name}</div>
                          <div className="text-xs text-gray-400">{sale.buyer_email}</div>
                          {sale.buyer_phone && <div className="text-xs text-gray-400">{sale.buyer_phone}</div>}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {sale.event_ticket_types?.name ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-600 font-medium">{sale.quantity}</td>
                        <td className="px-4 py-3 font-bold text-gray-900">
                          {fmtMoney(sale.total_amount, sale.currency)}
                        </td>
                        <td className="px-4 py-3 text-gray-500 capitalize">
                          {sale.payment_method ?? '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn('badge text-[11px]', sc.cls)}>{sc.label}</span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                          {fmtShort(sale.created_at)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {showAddTicket && (
        <AddTicketTypeModal
          eventId={id}
          onClose={() => setShowAddTicket(false)}
          onCreated={tt => setEvent(prev => prev ? { ...prev, event_ticket_types: [...(prev.event_ticket_types ?? []), tt] } : prev)}
        />
      )}
      {showRegSale && (
        <RegisterSaleModal
          eventId={id}
          ticketTypes={ticketTypes}
          onClose={() => setShowRegSale(false)}
          onCreated={sale => {
            setSales(prev => [sale, ...prev])
            // Update quantity_sold locally
            setEvent(prev => {
              if (!prev) return prev
              return {
                ...prev,
                event_ticket_types: prev.event_ticket_types.map(tt =>
                  tt.id === sale.ticket_type_id
                    ? { ...tt, quantity_sold: tt.quantity_sold + sale.quantity }
                    : tt
                ),
              }
            })
          }}
        />
      )}
    </div>
  )
}
