'use client'

import { useEffect, useState } from 'react'
import {
  Plus, FileText, DollarSign, CheckCircle2,
  AlertCircle, Send, Eye, Ban, ArrowDownRight,
  TrendingUp, Users, CreditCard, X,
  ChevronDown, Trash2,
} from 'lucide-react'
import { formatCurrency, formatDate, cn } from '@/lib/utils'
import { toast } from 'sonner'
import {
  useInvoices, usePatchInvoice, useCreateInvoice,
  usePayroll, usePatchPayroll, useCreatePayroll,
} from '@/hooks/useBilling'
import { useInfluencersList } from '@/hooks/useInfluencersList'
import { useCampaignsList } from '@/hooks/useCampaignsList'

// ── Types ─────────────────────────────────────────────────────────────────────
type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'void' | 'partially_paid'
type PayrollStatus = 'pending' | 'approved' | 'processing' | 'paid' | 'failed'

interface InvoiceItem { id: string; description: string; quantity: number; unit_price: number; total: number }
interface Invoice {
  id: string; invoice_number: string; client_name: string; client_email: string | null
  campaign?: { name: string } | null; issue_date: string; due_date: string
  subtotal: number; tax_rate: number; tax_amount: number; total: number
  currency: string; status: InvoiceStatus; paid_at: string | null; notes: string | null
  items?: InvoiceItem[]
}
interface PayrollItem {
  id: string
  influencer: { id: string; display_name: string; avatar_url: string | null }
  campaign: { name: string } | null
  amount: number; currency: string; description: string | null; status: 'pending' | 'paid'
}
interface PayrollRun {
  id: string; name: string; period_start: string; period_end: string
  total_amount: number; currency: string; status: PayrollStatus
  approved_at: string | null; processed_at: string | null; items?: PayrollItem[]
}

// ── Status configs ─────────────────────────────────────────────────────────────
const INVOICE_STATUS: Record<string, { label: string; cls: string; dot: string }> = {
  draft:           { label: 'Borrador',     cls: 'badge-gray',   dot: 'bg-gray-400'    },
  sent:            { label: 'Enviada',      cls: 'badge-blue',   dot: 'bg-blue-500'    },
  paid:            { label: 'Pagada',       cls: 'badge-green',  dot: 'bg-emerald-500' },
  overdue:         { label: 'Vencida',      cls: 'badge-red',    dot: 'bg-red-500'     },
  void:            { label: 'Anulada',      cls: 'badge-gray',   dot: 'bg-gray-300'    },
  partially_paid:  { label: 'Pago parcial', cls: 'badge-orange', dot: 'bg-orange-400'  },
}
const INVOICE_STATUS_FALLBACK = { label: 'Desconocido', cls: 'badge-gray', dot: 'bg-gray-300' }

const PAYROLL_STATUS: Record<string, { label: string; cls: string }> = {
  pending:    { label: 'Pendiente',  cls: 'badge-gray'   },
  approved:   { label: 'Aprobado',  cls: 'badge-blue'   },
  processing: { label: 'Procesando', cls: 'badge-orange' },
  paid:       { label: 'Pagado',    cls: 'badge-green'  },
  failed:     { label: 'Fallido',   cls: 'badge-red'    },
}
const PAYROLL_STATUS_FALLBACK = { label: 'Desconocido', cls: 'badge-gray' }

// ── Helpers ────────────────────────────────────────────────────────────────────
const GRADIENTS = ['from-pink-400 to-violet-500','from-blue-400 to-cyan-500','from-emerald-400 to-teal-500','from-orange-400 to-red-500']
function Avatar({ name, url, size = 8 }: { name: string; url?: string | null; size?: number }) {
  const idx = name.charCodeAt(0) % GRADIENTS.length
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  return url ? (
    <img src={url} alt={name} className={`w-${size} h-${size} rounded-full object-cover`} />
  ) : (
    <div className={`w-${size} h-${size} rounded-full bg-gradient-to-br ${GRADIENTS[idx]} flex items-center justify-center text-white text-xs font-bold flex-shrink-0`}>
      {initials}
    </div>
  )
}

// ── KPIs ──────────────────────────────────────────────────────────────────────
function BillingKPIs({ invoices, payrolls }: { invoices: Invoice[]; payrolls: PayrollRun[] }) {
  const totalBilled  = invoices.filter(i => i.status !== 'void').reduce((s, i) => s + i.total, 0)
  const totalPaid    = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.total, 0)
  const totalOverdue = invoices.filter(i => i.status === 'overdue').reduce((s, i) => s + i.total, 0)
  const totalPayroll = payrolls.filter(p => p.status !== 'failed').reduce((s, p) => s + p.total_amount, 0)
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      {[
        { icon: TrendingUp,   color: 'violet',  label: 'Total facturado', value: formatCurrency(totalBilled, 'CLP')  },
        { icon: CheckCircle2, color: 'emerald', label: 'Cobrado',          value: formatCurrency(totalPaid, 'CLP')    },
        { icon: AlertCircle,  color: 'red',     label: 'Vencido',          value: formatCurrency(totalOverdue, 'CLP') },
        { icon: Users,        color: 'blue',    label: 'Payroll total',    value: formatCurrency(totalPayroll, 'CLP') },
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

// ── Invoice Detail Panel ──────────────────────────────────────────────────────
function InvoicePanel({ invoice, onClose, onAction, onSend }: {
  invoice: Invoice; onClose: () => void; onAction: (action: string, id: string) => void; onSend: (invoice: Invoice) => void
}) {
  const s = INVOICE_STATUS[invoice.status] ?? INVOICE_STATUS_FALLBACK
  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div className="w-[480px] bg-white shadow-2xl overflow-y-auto flex flex-col">
        <div className="p-6 border-b border-gray-100">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-xs text-gray-400 font-mono mb-1">{invoice.invoice_number}</p>
              <h2 className="text-lg font-bold text-gray-900">{invoice.client_name}</h2>
              {invoice.campaign && <p className="text-sm text-gray-400 mt-0.5">{invoice.campaign.name}</p>}
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X className="h-4 w-4" /></button>
          </div>
          <div className="flex items-center gap-2">
            <span className={`badge ${s.cls} flex items-center gap-1.5`}>
              <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />{s.label}
            </span>
            <span className="text-xs text-gray-400">Vence {formatDate(invoice.due_date, 'd MMM yyyy')}</span>
          </div>
        </div>

        <div className="p-6 bg-gray-50 border-b border-gray-100">
          <p className="text-sm text-gray-400 mb-1">Total</p>
          <p className="text-3xl font-black text-gray-900">{formatCurrency(invoice.total, invoice.currency)}</p>
          {invoice.paid_at && (
            <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" /> Pagado el {formatDate(invoice.paid_at, 'd MMM yyyy')}
            </p>
          )}
        </div>

        <div className="p-6 space-y-4 flex-1">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Fecha emisión</p>
              <p className="font-medium text-gray-800">{formatDate(invoice.issue_date, 'd MMM yyyy')}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Vencimiento</p>
              <p className="font-medium text-gray-800">{formatDate(invoice.due_date, 'd MMM yyyy')}</p>
            </div>
            {invoice.client_email && (
              <div className="col-span-2">
                <p className="text-xs text-gray-400 mb-0.5">Email cliente</p>
                <p className="font-medium text-gray-800">{invoice.client_email}</p>
              </div>
            )}
          </div>

          {invoice.items && invoice.items.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Conceptos</p>
              <div className="space-y-2">
                {invoice.items.map(item => (
                  <div key={item.id} className="flex justify-between text-sm">
                    <div className="flex-1 pr-4">
                      <p className="text-gray-700">{item.description}</p>
                      <p className="text-xs text-gray-400">{item.quantity} × {formatCurrency(item.unit_price, invoice.currency)}</p>
                    </div>
                    <p className="font-semibold text-gray-900 whitespace-nowrap">{formatCurrency(item.total, invoice.currency)}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-4 border-t border-gray-100 space-y-1.5 text-sm">
                <div className="flex justify-between text-gray-500"><span>Subtotal</span><span>{formatCurrency(invoice.subtotal, invoice.currency)}</span></div>
                <div className="flex justify-between text-gray-500"><span>IVA ({invoice.tax_rate}%)</span><span>{formatCurrency(invoice.tax_amount, invoice.currency)}</span></div>
                <div className="flex justify-between font-bold text-gray-900 pt-1 border-t border-gray-100"><span>Total</span><span>{formatCurrency(invoice.total, invoice.currency)}</span></div>
              </div>
            </div>
          )}

          {invoice.notes && (
            <div className="p-3 bg-amber-50 rounded-xl border border-amber-100">
              <p className="text-xs text-amber-700">{invoice.notes}</p>
            </div>
          )}
        </div>

        <div className="p-6 border-t border-gray-100 space-y-2">
          {invoice.status === 'draft' && (
            <button onClick={() => onSend(invoice)}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700 transition-colors">
              <Send className="h-4 w-4" /> Enviar al cliente
            </button>
          )}
          {(invoice.status === 'sent' || invoice.status === 'overdue') && (
            <button onClick={() => onAction('mark_paid', invoice.id)}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-emerald-600 text-white text-sm font-semibold rounded-xl hover:bg-emerald-700 transition-colors">
              <CheckCircle2 className="h-4 w-4" /> Marcar como pagada
            </button>
          )}
          {['draft', 'sent', 'overdue'].includes(invoice.status) && (
            <button onClick={() => onAction('void', invoice.id)}
              className="w-full flex items-center justify-center gap-2 py-2 text-sm font-medium text-gray-500 rounded-xl hover:bg-gray-100 transition-colors">
              <Ban className="h-4 w-4" /> Anular factura
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── New Invoice Modal ─────────────────────────────────────────────────────────
interface LineItem { description: string; quantity: number; unit_price: number }

function NewInvoiceModal({ onClose }: { onClose: () => void }) {
  const today = new Date().toISOString().slice(0, 10)
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)

  const [form, setForm] = useState({
    client_name: '', client_email: '', campaign_id: '',
    issue_date: today, due_date: in30, tax_rate: 19, currency: 'CLP', notes: '',
  })
  const [items, setItems] = useState<LineItem[]>([{ description: '', quantity: 1, unit_price: 0 }])
  const create = useCreateInvoice()
  const { data: campaignsData } = useCampaignsList({ limit: 100 })
  const campaigns = campaignsData?.data ?? []

  const f = (k: keyof typeof form, v: string | number) => setForm(p => ({ ...p, [k]: v }))

  function updateItem(i: number, k: keyof LineItem, v: string | number) {
    setItems(p => p.map((item, idx) => idx === i ? { ...item, [k]: v } : item))
  }
  function addItem() { setItems(p => [...p, { description: '', quantity: 1, unit_price: 0 }]) }
  function removeItem(i: number) { setItems(p => p.filter((_, idx) => idx !== i)) }

  const subtotal = items.reduce((s, it) => s + (it.quantity * it.unit_price), 0)
  const tax = subtotal * (form.tax_rate / 100)
  const total = subtotal + tax

  async function submit() {
    if (!form.client_name) { toast.error('Nombre del cliente requerido'); return }
    await create.mutateAsync({
      ...form,
      campaign_id: form.campaign_id || null,
      items: items.filter(it => it.description),
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">Nueva factura</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400"><X className="h-5 w-5" /></button>
        </div>

        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {/* Client */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Nombre del cliente *</label>
              <input className="input" value={form.client_name} onChange={e => f('client_name', e.target.value)} placeholder="Ej. Nike LATAM" />
            </div>
            <div>
              <label className="label">Email del cliente</label>
              <input className="input" type="email" value={form.client_email} onChange={e => f('client_email', e.target.value)} placeholder="billing@cliente.com" />
            </div>
          </div>

          {/* Campaign + Currency */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Campaña (opcional)</label>
              <div className="relative">
                <select className="input appearance-none pr-8" value={form.campaign_id} onChange={e => f('campaign_id', e.target.value)}>
                  <option value="">Sin campaña</option>
                  {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
              </div>
            </div>
            <div>
              <label className="label">Moneda</label>
              <div className="relative">
                <select className="input appearance-none pr-8" value={form.currency} onChange={e => f('currency', e.target.value)}>
                  {['CLP', 'USD', 'EUR', 'MXN', 'COP', 'ARS'].map(c => <option key={c}>{c}</option>)}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
              </div>
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="label">Fecha emisión</label>
              <input className="input" type="date" value={form.issue_date} onChange={e => f('issue_date', e.target.value)} />
            </div>
            <div>
              <label className="label">Fecha vencimiento</label>
              <input className="input" type="date" value={form.due_date} onChange={e => f('due_date', e.target.value)} />
            </div>
            <div>
              <label className="label">IVA (%)</label>
              <input className="input" type="number" min={0} max={100} value={form.tax_rate} onChange={e => f('tax_rate', Number(e.target.value))} />
            </div>
          </div>

          {/* Line items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="label mb-0">Conceptos</label>
              <button onClick={addItem} className="text-xs text-violet-600 hover:underline flex items-center gap-1">
                <Plus className="h-3 w-3" /> Agregar línea
              </button>
            </div>
            <div className="space-y-2">
              {items.map((it, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-start">
                  <input className="input col-span-6" placeholder="Descripción" value={it.description}
                    onChange={e => updateItem(i, 'description', e.target.value)} />
                  <input className="input col-span-2 text-center" type="number" min={1} placeholder="Cant." value={it.quantity}
                    onChange={e => updateItem(i, 'quantity', Number(e.target.value))} />
                  <input className="input col-span-3" type="number" min={0} placeholder="Precio unit." value={it.unit_price}
                    onChange={e => updateItem(i, 'unit_price', Number(e.target.value))} />
                  <button onClick={() => removeItem(i)} className="h-10 flex items-center justify-center text-gray-300 hover:text-red-400 transition-colors">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="label">Notas</label>
            <textarea className="input resize-none" rows={2} value={form.notes} onChange={e => f('notes', e.target.value)} placeholder="Notas internas o para el cliente…" />
          </div>

          {/* Totals */}
          <div className="bg-gray-50 rounded-xl p-4 space-y-1.5 text-sm">
            <div className="flex justify-between text-gray-500"><span>Subtotal</span><span>{formatCurrency(subtotal, form.currency)}</span></div>
            <div className="flex justify-between text-gray-500"><span>IVA ({form.tax_rate}%)</span><span>{formatCurrency(tax, form.currency)}</span></div>
            <div className="flex justify-between font-bold text-gray-900 pt-2 border-t border-gray-200">
              <span>Total</span><span>{formatCurrency(total, form.currency)}</span>
            </div>
          </div>
        </div>

        <div className="flex justify-between gap-3 p-6 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 rounded-xl border border-gray-200 hover:bg-gray-50">Cancelar</button>
          <button onClick={submit} disabled={create.isPending}
            className="flex items-center gap-2 px-5 py-2 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700 disabled:opacity-50 transition-colors">
            {create.isPending ? <div className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" /> : <FileText className="h-4 w-4" />}
            Crear factura
          </button>
        </div>
      </div>
    </div>
  )
}

// ── New Payroll Modal ─────────────────────────────────────────────────────────
interface PayrollLineItem { influencer_id: string; campaign_id: string; amount: number; description: string }

function NewPayrollModal({ onClose }: { onClose: () => void }) {
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState({ name: '', period_start: today, period_end: today, currency: 'CLP' })
  const [items, setItems] = useState<PayrollLineItem[]>([{ influencer_id: '', campaign_id: '', amount: 0, description: '' }])
  const create = useCreatePayroll()
  const { data: infData } = useInfluencersList({ limit: 200 })
  const { data: campData } = useCampaignsList({ limit: 100 })
  const influencers = infData?.data ?? []
  const campaigns = campData?.data ?? []

  const f = (k: keyof typeof form, v: string) => setForm(p => ({ ...p, [k]: v }))
  function updateItem(i: number, k: keyof PayrollLineItem, v: string | number) {
    setItems(p => p.map((item, idx) => idx === i ? { ...item, [k]: v } : item))
  }
  function addItem() { setItems(p => [...p, { influencer_id: '', campaign_id: '', amount: 0, description: '' }]) }
  function removeItem(i: number) { setItems(p => p.filter((_, idx) => idx !== i)) }

  const total = items.reduce((s, it) => s + (it.amount ?? 0), 0)

  async function submit() {
    if (!form.name) { toast.error('Nombre del payroll requerido'); return }
    const validItems = items.filter(it => it.influencer_id && it.amount > 0)
    if (validItems.length === 0) { toast.error('Agrega al menos un influencer con monto'); return }
    await create.mutateAsync({ ...form, items: validItems })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">Nuevo payroll run</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400"><X className="h-5 w-5" /></button>
        </div>

        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="label">Nombre del run *</label>
              <input className="input" value={form.name} onChange={e => f('name', e.target.value)} placeholder="Ej. Payroll Mayo 2026 — Semana 1" />
            </div>
            <div>
              <label className="label">Periodo inicio</label>
              <input className="input" type="date" value={form.period_start} onChange={e => f('period_start', e.target.value)} />
            </div>
            <div>
              <label className="label">Periodo fin</label>
              <input className="input" type="date" value={form.period_end} onChange={e => f('period_end', e.target.value)} />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="label mb-0">Pagos a influencers</label>
              <button onClick={addItem} className="text-xs text-violet-600 hover:underline flex items-center gap-1">
                <Plus className="h-3 w-3" /> Agregar
              </button>
            </div>
            <div className="space-y-2">
              {items.map((it, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-start">
                  <div className="col-span-4 relative">
                    <select className="input appearance-none pr-6 text-sm" value={it.influencer_id}
                      onChange={e => updateItem(i, 'influencer_id', e.target.value)}>
                      <option value="">Influencer…</option>
                      {influencers.map(inf => <option key={inf.id} value={inf.id}>{inf.display_name}</option>)}
                    </select>
                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
                  </div>
                  <div className="col-span-3 relative">
                    <select className="input appearance-none pr-6 text-sm" value={it.campaign_id}
                      onChange={e => updateItem(i, 'campaign_id', e.target.value)}>
                      <option value="">Campaña (opt.)</option>
                      {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
                  </div>
                  <input className="input col-span-2 text-sm" type="number" min={0} placeholder="Monto" value={it.amount || ''}
                    onChange={e => updateItem(i, 'amount', Number(e.target.value))} />
                  <input className="input col-span-2 text-sm" placeholder="Concepto" value={it.description}
                    onChange={e => updateItem(i, 'description', e.target.value)} />
                  <button onClick={() => removeItem(i)} className="h-10 flex items-center justify-center text-gray-300 hover:text-red-400">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-gray-50 rounded-xl p-4 flex items-center justify-between text-sm">
            <span className="text-gray-500">Total a pagar</span>
            <span className="text-xl font-black text-gray-900">{formatCurrency(total, form.currency)}</span>
          </div>
        </div>

        <div className="flex justify-between gap-3 p-6 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 rounded-xl border border-gray-200 hover:bg-gray-50">Cancelar</button>
          <button onClick={submit} disabled={create.isPending}
            className="flex items-center gap-2 px-5 py-2 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700 disabled:opacity-50 transition-colors">
            {create.isPending ? <div className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" /> : <CreditCard className="h-4 w-4" />}
            Crear payroll
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Finanzas este mes (movido acá desde el dashboard admin, pedido por Pri) ──
function MonthFinanceCards() {
  const [data, setData] = useState<{ revenue_month: number; payroll_month: number; margin: number; margin_pct: number } | null>(null)

  useEffect(() => {
    fetch('/api/dashboard')
      .then(res => res.json())
      .then(json => setData(json?.kpis ?? null))
      .catch(() => setData(null))
  }, [])

  if (!data) return null

  return (
    <div className="space-y-2">
      <h2 className="px-1 text-xs font-bold uppercase tracking-wider text-gray-400">Finanzas este mes</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center flex-shrink-0">
              <DollarSign className="h-4 w-4 text-emerald-600" />
            </div>
            <div>
              <div className="text-xl font-bold text-gray-900">{formatCurrency(data.revenue_month, 'CLP')}</div>
              <div className="text-xs text-gray-400">Facturado este mes</div>
            </div>
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-red-100 flex items-center justify-center flex-shrink-0">
              <ArrowDownRight className="h-4 w-4 text-red-600" />
            </div>
            <div>
              <div className="text-xl font-bold text-gray-900">{formatCurrency(data.payroll_month, 'CLP')}</div>
              <div className="text-xs text-gray-400">Payroll pagado, este mes</div>
            </div>
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
              <TrendingUp className="h-4 w-4 text-amber-600" />
            </div>
            <div>
              <div className="text-xl font-bold text-gray-900">{Math.round(data.margin_pct || 0)}%</div>
              <div className="text-xs text-gray-400">Margen bruto — {formatCurrency(Math.max(0, data.margin), 'CLP')} neto</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export function BillingClient() {
  const [tab, setTab] = useState<'invoices' | 'payroll'>('invoices')
  const [selected, setSelected] = useState<Invoice | null>(null)
  const [sendModal, setSendModal] = useState<Invoice | null>(null)
  const [sendEmail, setSendEmail] = useState('')
  const [sendNote, setSendNote] = useState('')
  const [sending, setSending] = useState(false)
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [showNewInvoice, setShowNewInvoice] = useState(false)
  const [showNewPayroll, setShowNewPayroll] = useState(false)

  const { data: invoicesData, isLoading: loadingInvoices } = useInvoices({ status: filterStatus === 'all' ? undefined : filterStatus })
  const { data: payrollData, isLoading: loadingPayroll } = usePayroll()
  const patchInvoice = usePatchInvoice()
  const patchPayroll = usePatchPayroll()

  const invoices: Invoice[] = invoicesData?.data ?? []
  const payrolls: PayrollRun[] = payrollData?.data ?? []

  function handleAction(action: string, id: string) {
    setSelected(null)
    const labels: Record<string, string> = { send: 'Factura enviada', mark_paid: 'Factura marcada como pagada', void: 'Factura anulada' }
    patchInvoice.mutate(
      { id, payload: { action } },
      { onSuccess: () => toast.success(labels[action] ?? 'Actualizado') }
    )
  }

  async function handleSendInvoice() {
    if (!sendModal) return
    if (!sendEmail) { toast.error('Ingresa un email de destino'); return }
    setSending(true)
    try {
      // Mark invoice as sent
      const res = await fetch(`/api/invoices/${sendModal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send', send_to: sendEmail, note: sendNote }),
      })
      if (!res.ok) {
        const j = await res.json()
        throw new Error(j.error ?? 'Error al enviar')
      }
      toast.success(`Factura enviada a ${sendEmail}`)
      setSendModal(null)
      setSelected(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al enviar factura')
    } finally {
      setSending(false)
    }
  }

  const statusFilters: Array<{ value: string; label: string }> = [
    { value: 'all', label: 'Todas' }, { value: 'draft', label: 'Borrador' },
    { value: 'sent', label: 'Enviadas' }, { value: 'paid', label: 'Pagadas' },
    { value: 'overdue', label: 'Vencidas' }, { value: 'void', label: 'Anuladas' },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Billing</h1>
          <p className="text-sm text-gray-500 mt-0.5">Facturación a clientes y pagos a influencers</p>
        </div>
        <button
          onClick={() => tab === 'invoices' ? setShowNewInvoice(true) : setShowNewPayroll(true)}
          className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white text-sm font-semibold rounded-lg hover:bg-violet-700 transition-colors">
          <Plus className="h-4 w-4" />
          {tab === 'invoices' ? 'Nueva factura' : 'Nuevo payroll'}
        </button>
      </div>

      <MonthFinanceCards />
      <BillingKPIs invoices={invoices} payrolls={payrolls} />

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-gray-100 rounded-xl w-fit">
        {[
          { id: 'invoices', label: 'Facturas', icon: FileText },
          { id: 'payroll',  label: 'Payroll',  icon: CreditCard },
        ].map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id as typeof tab)}
            className={cn('flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
              tab === id ? 'bg-white text-violet-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            )}>
            <Icon className="h-4 w-4" />{label}
          </button>
        ))}
      </div>

      {/* ── Invoices tab ── */}
      {tab === 'invoices' && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {statusFilters.map(f => (
              <button key={f.value} onClick={() => setFilterStatus(f.value)}
                className={cn('px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                  filterStatus === f.value ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                )}>
                {f.label}
                <span className="ml-1.5 text-xs opacity-70">
                  {f.value === 'all' ? invoices.length : invoices.filter(i => i.status === f.value).length}
                </span>
              </button>
            ))}
          </div>

          <div className="card overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="border-b border-gray-100">
                  {['Número', 'Cliente', 'Campaña', 'Emisión', 'Vencimiento', 'Total', 'Estado', ''].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider bg-gray-50">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loadingInvoices ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 8 }).map((_, j) => (
                        <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse w-full" /></td>
                      ))}
                    </tr>
                  ))
                ) : invoices.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-sm text-gray-400">
                    {filterStatus === 'all' ? 'No hay facturas aún — crea tu primera factura' : 'No hay facturas con este estado'}
                  </td></tr>
                ) : invoices.map(inv => {
                  const s = INVOICE_STATUS[inv.status] ?? INVOICE_STATUS_FALLBACK
                  const overdue = inv.status === 'overdue'
                  return (
                    <tr key={inv.id} className="hover:bg-gray-50/70 transition-colors group cursor-pointer" onClick={() => setSelected(inv)}>
                      <td className="px-4 py-3"><span className="font-mono text-xs font-semibold text-gray-700">{inv.invoice_number}</span></td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{inv.client_name}</td>
                      <td className="px-4 py-3 text-sm text-gray-500 max-w-[180px]"><span className="line-clamp-1">{inv.campaign?.name ?? '—'}</span></td>
                      <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">{formatDate(inv.issue_date, 'd MMM yy')}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={cn('text-sm', overdue ? 'text-red-600 font-semibold' : 'text-gray-500')}>{formatDate(inv.due_date, 'd MMM yy')}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('text-sm font-bold', overdue ? 'text-red-600' : 'text-gray-900')}>{formatCurrency(inv.total, inv.currency)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`badge ${s.cls} flex items-center gap-1.5 w-fit`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />{s.label}
                        </span>
                      </td>
                      <td className="px-4 py-3"><Eye className="h-4 w-4 text-gray-300 group-hover:text-violet-500 transition-colors" /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Payroll tab ── */}
      {tab === 'payroll' && (
        <div className="space-y-4">
          {loadingPayroll ? (
            <div className="card p-6 animate-pulse space-y-3">
              {[1,2,3].map(i => <div key={i} className="h-16 bg-gray-100 rounded-xl" />)}
            </div>
          ) : payrolls.length === 0 ? (
            <div className="card p-12 text-center">
              <CreditCard className="h-10 w-10 text-gray-200 mx-auto mb-3" />
              <p className="text-sm text-gray-400">No hay payroll runs aún</p>
              <button onClick={() => setShowNewPayroll(true)} className="mt-3 text-xs text-violet-600 hover:underline">Crear el primero →</button>
            </div>
          ) : payrolls.map(run => {
            const s = PAYROLL_STATUS[run.status] ?? PAYROLL_STATUS_FALLBACK
            return (
              <div key={run.id} className="card overflow-x-auto">
                <div className="px-6 py-4 flex items-center justify-between border-b border-gray-100">
                  <div>
                    <h3 className="font-bold text-gray-900">{run.name}</h3>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {formatDate(run.period_start, 'd MMM')} – {formatDate(run.period_end, 'd MMM yyyy')}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-lg font-black text-gray-900">{formatCurrency(run.total_amount, run.currency)}</p>
                      <p className="text-xs text-gray-400">{run.items?.length ?? 0} influencer{(run.items?.length ?? 0) !== 1 ? 's' : ''}</p>
                    </div>
                    <span className={`badge ${s.cls}`}>{s.label}</span>
                    {/* Progressive action buttons */}
                    {run.status === 'pending' && (
                      <button onClick={() => patchPayroll.mutate({ run_id: run.id, action: 'approve' })}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 transition-colors">
                        <CheckCircle2 className="h-3 w-3" /> Aprobar
                      </button>
                    )}
                    {run.status === 'approved' && (
                      <button onClick={() => patchPayroll.mutate({ run_id: run.id, action: 'process' })}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 text-white text-xs font-semibold rounded-lg hover:bg-violet-700 transition-colors">
                        <DollarSign className="h-3 w-3" /> Procesar
                      </button>
                    )}
                    {run.status === 'processing' && (
                      <button onClick={() => patchPayroll.mutate({ run_id: run.id, action: 'complete' })}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-xs font-semibold rounded-lg hover:bg-emerald-700 transition-colors">
                        <CheckCircle2 className="h-3 w-3" /> Completar
                      </button>
                    )}
                  </div>
                </div>

                <div className="divide-y divide-gray-50">
                  {run.items?.map(item => (
                    <div key={item.id} className="px-6 py-3 flex items-center gap-4">
                      <Avatar name={item.influencer.display_name} url={item.influencer.avatar_url} size={8} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900">{item.influencer.display_name}</p>
                        <p className="text-xs text-gray-400 truncate">
                          {item.campaign?.name ?? 'Sin campaña'}{item.description && ` — ${item.description}`}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-bold text-gray-900">{formatCurrency(item.amount, item.currency)}</p>
                        <span className={`text-xs font-medium ${item.status === 'paid' ? 'text-emerald-600' : 'text-amber-500'}`}>
                          {item.status === 'paid' ? '✓ Pagado' : '⏳ Pendiente'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                {run.status === 'paid' && run.processed_at && (
                  <div className="px-6 py-3 bg-emerald-50 border-t border-emerald-100">
                    <p className="text-xs text-emerald-700 flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Procesado el {formatDate(run.processed_at, "d 'de' MMMM yyyy")}
                    </p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Modals */}
      {showNewInvoice  && <NewInvoiceModal  onClose={() => setShowNewInvoice(false)}  />}
      {showNewPayroll  && <NewPayrollModal  onClose={() => setShowNewPayroll(false)}  />}

      {/* Invoice detail panel */}
      {selected && (
        <InvoicePanel invoice={selected} onClose={() => setSelected(null)} onAction={handleAction} onSend={inv => { setSendModal(inv); setSendEmail(inv.client_email ?? ''); setSendNote('') }} />
      )}

      {/* Send invoice modal */}
      {sendModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">Enviar factura</h2>
              <button onClick={() => setSendModal(null)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-gray-500">Factura <span className="font-mono font-semibold text-gray-800">{sendModal.invoice_number}</span> — {formatCurrency(sendModal.total, sendModal.currency)}</p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Email de destino *</label>
                <input
                  type="email"
                  className="input-base w-full"
                  value={sendEmail}
                  onChange={e => setSendEmail(e.target.value)}
                  placeholder="cliente@empresa.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Nota adicional <span className="text-gray-400 text-xs">(opcional)</span></label>
                <textarea
                  className="input-base w-full resize-none"
                  rows={3}
                  value={sendNote}
                  onChange={e => setSendNote(e.target.value)}
                  placeholder="Mensaje para el cliente..."
                />
              </div>
            </div>
            <div className="flex gap-3 p-6 border-t border-gray-100">
              <button onClick={() => setSendModal(null)} className="flex-1 px-4 py-2 text-sm text-gray-600 rounded-xl border border-gray-200 hover:bg-gray-50">Cancelar</button>
              <button
                onClick={handleSendInvoice}
                disabled={sending || !sendEmail}
                className="flex-1 flex items-center justify-center gap-2 px-5 py-2 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700 disabled:opacity-50 transition-colors"
              >
                {sending ? <div className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" /> : <Send className="h-4 w-4" />}
                {sending ? 'Enviando…' : 'Enviar factura'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
