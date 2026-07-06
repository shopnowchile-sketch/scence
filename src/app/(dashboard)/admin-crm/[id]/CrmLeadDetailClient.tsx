'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, Send, Loader2, Mail, Phone, MapPin, Briefcase, Building2, Clock, Tag, CalendarDays, CheckCircle2, Circle } from 'lucide-react'
import { cn, formatDate } from '@/lib/utils'
import { toast } from 'sonner'

type Activity = {
  id: string
  action_type: string
  description: string | null
  created_at: string
}

type Lead = {
  id: string
  contact_name: string | null
  company_name: string | null
  email: string | null
  phone_1: string | null
  phone_2: string | null
  address: string | null
  commune: string | null
  region: string | null
  industry: string | null
  economic_activity: string | null
  company_size: string | null
  employee_count: string | null
  website: string | null
  qualification_status: 'unqualified' | 'qualified' | 'rejected' | 'contacted' | 'converted'
  qualification_notes: string | null
  contacted_at: string | null
  created_at: string
  source: string | null
  imported_at: string | null
  app_connected: boolean
  app_last_sign_in_at: string | null
  activities: Activity[]
}

const STATUS_CONFIG: Record<Lead['qualification_status'], { label: string; cls: string }> = {
  unqualified: { label: 'Sin calificar', cls: 'bg-gray-100 text-gray-500' },
  qualified:   { label: 'Califica',      cls: 'bg-green-100 text-green-700' },
  rejected:    { label: 'No califica',   cls: 'bg-red-100 text-red-600' },
  contacted:   { label: 'Contactado',    cls: 'bg-blue-100 text-blue-700' },
  converted:   { label: 'Convertido',    cls: 'bg-violet-100 text-violet-700' },
}

const ACTION_LABEL: Record<string, string> = {
  email_sent: 'Email enviado',
  qualified: 'Calificado',
  rejected: 'Rechazado',
  note: 'Nota',
  contacted: 'Contactado',
  converted: 'Convertido',
}

export function CrmLeadDetailClient({ id }: { id: string }) {
  const [lead, setLead] = useState<Lead | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [note, setNote] = useState('')
  const [savingNote, setSavingNote] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`/api/crm-leads/${id}`)
      const j = await r.json()
      if (r.ok) setLead(j.data)
    } catch { /* noop */ }
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  async function updateStatus(status: Lead['qualification_status']) {
    if (!lead) return
    try {
      const r = await fetch(`/api/crm-leads/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qualification_status: status }),
      })
      if (!r.ok) throw new Error()
      toast.success('Calificación actualizada')
      load()
    } catch {
      toast.error('No se pudo actualizar')
    }
  }

  async function sendIntro() {
    if (!lead?.email) { toast.error('Este lead no tiene email'); return }
    setSending(true)
    try {
      const r = await fetch(`/api/crm-leads/${id}/send-intro`, { method: 'POST' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? 'Error al enviar')
      toast.success('Email enviado')
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al enviar')
    }
    setSending(false)
  }

  async function saveNote() {
    if (!note.trim()) return
    setSavingNote(true)
    try {
      const r = await fetch(`/api/crm-leads/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qualification_notes: note }),
      })
      if (!r.ok) throw new Error()
      setNote('')
      toast.success('Nota guardada')
      load()
    } catch {
      toast.error('No se pudo guardar la nota')
    }
    setSavingNote(false)
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 text-violet-400 animate-spin" /></div>
  }

  if (!lead) {
    return <div className="card p-12 text-center text-gray-400">Lead no encontrado.</div>
  }

  const cfg = STATUS_CONFIG[lead.qualification_status] ?? STATUS_CONFIG.unqualified

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link href="/admin-crm" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800">
          <ArrowLeft className="h-4 w-4" /> CRM
        </Link>
        <span className="text-gray-200">/</span>
        <span className="text-sm font-semibold text-gray-800 truncate max-w-[240px]">{lead.company_name}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <div className="card p-6">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Building2 className="h-5 w-5 text-violet-400" />
                  <h1 className="text-lg font-bold text-gray-900">{lead.company_name || '—'}</h1>
                </div>
                <p className="text-sm text-gray-400">{lead.contact_name}</p>
              </div>
              <select
                value={lead.qualification_status}
                onChange={e => updateStatus(e.target.value as Lead['qualification_status'])}
                className={cn('text-xs font-semibold rounded-full px-3 py-1.5 border-0 outline-none cursor-pointer', cfg.cls)}
              >
                {Object.entries(STATUS_CONFIG).map(([k, c]) => (
                  <option key={k} value={k}>{c.label}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4 mt-5 text-sm">
              <div className="flex items-center gap-2 text-gray-600"><Mail className="h-3.5 w-3.5 text-gray-300" /> {lead.email || '—'}</div>
              <div className="flex items-center gap-2 text-gray-600"><Phone className="h-3.5 w-3.5 text-gray-300" /> {lead.phone_1 || '—'}</div>
              <div className="flex items-center gap-2 text-gray-600"><MapPin className="h-3.5 w-3.5 text-gray-300" /> {[lead.commune, lead.region].filter(Boolean).join(' · ') || '—'}</div>
              <div className="flex items-center gap-2 text-gray-600"><Briefcase className="h-3.5 w-3.5 text-gray-300" /> {lead.industry || '—'}</div>
            </div>

            {lead.economic_activity && (
              <p className="mt-4 text-xs text-gray-400 leading-relaxed">{lead.economic_activity}</p>
            )}

            <div className="flex items-center gap-3 mt-5 flex-wrap text-xs text-gray-400">
              <span className="badge badge-gray">{lead.company_size || 'Sin dato'}</span>
              <span className="badge badge-gray">{lead.employee_count || 'Sin dato'} empleados</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-5 pt-5 border-t border-gray-100 text-sm">
              <div className="flex items-center gap-2 text-gray-600">
                <Tag className="h-3.5 w-3.5 text-gray-300 flex-shrink-0" />
                <div>
                  <div className="text-xs text-gray-400">Origen</div>
                  <div className="font-medium">{lead.source || '—'}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 text-gray-600">
                <CalendarDays className="h-3.5 w-3.5 text-gray-300 flex-shrink-0" />
                <div>
                  <div className="text-xs text-gray-400">Importado</div>
                  <div className="font-medium">{lead.imported_at ? formatDate(lead.imported_at) : '—'}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 text-gray-600">
                {lead.app_connected
                  ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
                  : <Circle className="h-3.5 w-3.5 text-gray-300 flex-shrink-0" />}
                <div>
                  <div className="text-xs text-gray-400">Conectado a la app</div>
                  <div className="font-medium">
                    {lead.app_connected
                      ? (lead.app_last_sign_in_at ? `Sí · ${formatDate(lead.app_last_sign_in_at, "d MMM yyyy HH:mm")}` : 'Sí')
                      : 'No'}
                  </div>
                </div>
              </div>
            </div>

            <button
              onClick={sendIntro}
              disabled={sending || !lead.email}
              className="mt-5 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Enviar email de presentación
            </button>
          </div>

          <div className="card p-6">
            <h2 className="text-sm font-bold text-gray-900 mb-3">Agregar nota</h2>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Ej: llamé y quedó de revisarlo con el dueño..."
              className="w-full rounded-xl border border-gray-200 p-3 text-sm outline-none focus:border-violet-400 min-h-[80px]"
            />
            <button
              onClick={saveNote}
              disabled={savingNote || !note.trim()}
              className="mt-2 px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              Guardar nota
            </button>
          </div>
        </div>

        <div className="card p-6">
          <h2 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
            <Clock className="h-4 w-4 text-gray-400" /> Historial
          </h2>
          {lead.activities.length === 0 ? (
            <p className="text-sm text-gray-400">Sin actividad todavía.</p>
          ) : (
            <div className="space-y-4">
              {lead.activities.map(a => (
                <div key={a.id} className="border-l-2 border-violet-200 pl-3">
                  <p className="text-xs font-semibold text-gray-700">{ACTION_LABEL[a.action_type] ?? a.action_type}</p>
                  {a.description && <p className="text-xs text-gray-500 mt-0.5">{a.description}</p>}
                  <p className="text-[10px] text-gray-300 mt-0.5">
                    {new Date(a.created_at).toLocaleString('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
