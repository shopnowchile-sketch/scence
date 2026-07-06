'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { Search, Send, Loader2, Building2, CheckCircle2, Circle } from 'lucide-react'
import { cn, formatDate } from '@/lib/utils'
import { toast } from 'sonner'

type Lead = {
  id: string
  contact_name: string | null
  company_name: string | null
  email: string | null
  phone_1: string | null
  commune: string | null
  region: string | null
  industry: string | null
  company_size: string | null
  employee_count: string | null
  qualification_status: 'unqualified' | 'qualified' | 'rejected' | 'contacted' | 'converted'
  contacted_at: string | null
  created_at: string
  source: string | null
  imported_at: string | null
  app_connected: boolean
  app_last_sign_in_at: string | null
}

const STATUS_CONFIG: Record<Lead['qualification_status'], { label: string; cls: string }> = {
  unqualified: { label: 'Sin calificar', cls: 'bg-gray-100 text-gray-500' },
  qualified:   { label: 'Califica',      cls: 'bg-green-100 text-green-700' },
  rejected:    { label: 'No califica',   cls: 'bg-red-100 text-red-600' },
  contacted:   { label: 'Contactado',    cls: 'bg-blue-100 text-blue-700' },
  converted:   { label: 'Convertido',    cls: 'bg-violet-100 text-violet-700' },
}

export function CrmLeadsClient() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [qualification, setQualification] = useState('')
  const [source, setSource] = useState('')
  const [sources, setSources] = useState<string[]>([])
  const [sendingId, setSendingId] = useState<string | null>(null)
  const limit = 50

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), limit: String(limit) })
    if (search) params.set('search', search)
    if (qualification) params.set('qualification', qualification)
    if (source) params.set('source', source)
    try {
      const r = await fetch(`/api/crm-leads?${params}`)
      const j = await r.json()
      setLeads(j.data ?? [])
      setTotal(j.total ?? 0)
      if (Array.isArray(j.sources)) setSources(j.sources)
    } catch {
      toast.error('Error cargando leads')
    }
    setLoading(false)
  }, [page, search, qualification, source])

  useEffect(() => { load() }, [load])

  async function updateStatus(id: string, status: Lead['qualification_status']) {
    setLeads(prev => prev.map(l => l.id === id ? { ...l, qualification_status: status } : l))
    try {
      const r = await fetch(`/api/crm-leads/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qualification_status: status }),
      })
      if (!r.ok) throw new Error()
    } catch {
      toast.error('No se pudo actualizar la calificación')
      load()
    }
  }

  async function sendIntro(lead: Lead) {
    if (!lead.email) { toast.error('Este lead no tiene email'); return }
    setSendingId(lead.id)
    try {
      const r = await fetch(`/api/crm-leads/${lead.id}/send-intro`, { method: 'POST' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? 'Error al enviar')
      toast.success(`Email enviado a ${lead.email}`)
      setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, contacted_at: new Date().toISOString() } : l))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al enviar')
    }
    setSendingId(null)
  }

  const totalPages = Math.max(1, Math.ceil(total / limit))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">CRM — Prospectos</h1>
          <p className="text-sm text-gray-400">{total.toLocaleString('es-CL')} empresas cargadas · calificar y contactar</p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            value={search}
            onChange={e => { setPage(1); setSearch(e.target.value) }}
            placeholder="Buscar por empresa, contacto o email..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm outline-none focus:border-violet-400"
          />
        </div>
        <select
          value={qualification}
          onChange={e => { setPage(1); setQualification(e.target.value) }}
          className="px-3 py-2.5 rounded-xl border border-gray-200 bg-white text-sm text-gray-700"
        >
          <option value="">Todos los estados</option>
          {Object.entries(STATUS_CONFIG).map(([k, cfg]) => (
            <option key={k} value={k}>{cfg.label}</option>
          ))}
        </select>
        <select
          value={source}
          onChange={e => { setPage(1); setSource(e.target.value) }}
          className="px-3 py-2.5 rounded-xl border border-gray-200 bg-white text-sm text-gray-700"
        >
          <option value="">Todos los orígenes</option>
          {sources.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead>
            <tr className="border-b border-gray-50 text-left text-xs text-gray-400">
              <th className="px-4 py-3 font-semibold">Empresa</th>
              <th className="px-4 py-3 font-semibold">Contacto</th>
              <th className="px-4 py-3 font-semibold">Ubicación</th>
              <th className="px-4 py-3 font-semibold">Rubro</th>
              <th className="px-4 py-3 font-semibold">Origen</th>
              <th className="px-4 py-3 font-semibold">Calificación</th>
              <th className="px-4 py-3 font-semibold">Último email</th>
              <th className="px-4 py-3 font-semibold">Conectado</th>
              <th className="px-4 py-3 font-semibold text-right">Acción</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-400">Cargando…</td></tr>
            ) : leads.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-400">Sin resultados</td></tr>
            ) : leads.map(lead => {
              const cfg = STATUS_CONFIG[lead.qualification_status] ?? STATUS_CONFIG.unqualified
              return (
                <tr key={lead.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                  <td className="px-4 py-3">
                    <Link href={`/admin-crm/${lead.id}`} className="flex items-center gap-2 font-medium text-gray-900 hover:text-violet-600">
                      <Building2 className="h-3.5 w-3.5 text-gray-300 flex-shrink-0" />
                      <span className="truncate max-w-[200px]">{lead.company_name || '—'}</span>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    <div className="truncate max-w-[180px]">{lead.contact_name || '—'}</div>
                    <div className="text-xs text-gray-400 truncate max-w-[180px]">{lead.email}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{lead.commune || '—'}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs truncate max-w-[160px]">{lead.industry || '—'}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs truncate max-w-[140px]" title={lead.source ?? undefined}>
                    {lead.source || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={lead.qualification_status}
                      onChange={e => updateStatus(lead.id, e.target.value as Lead['qualification_status'])}
                      className={cn('text-xs font-semibold rounded-full px-2.5 py-1 border-0 outline-none cursor-pointer', cfg.cls)}
                    >
                      {Object.entries(STATUS_CONFIG).map(([k, c]) => (
                        <option key={k} value={k}>{c.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {lead.contacted_at ? new Date(lead.contacted_at).toLocaleDateString('es-CL') : 'Nunca'}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {lead.app_connected ? (
                      <span className="inline-flex items-center gap-1 text-emerald-600" title={lead.app_last_sign_in_at ? `Último ingreso: ${formatDate(lead.app_last_sign_in_at, "d MMM yyyy HH:mm")}` : undefined}>
                        <CheckCircle2 className="h-3.5 w-3.5" /> Sí
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-gray-300">
                        <Circle className="h-3.5 w-3.5" /> No
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => sendIntro(lead)}
                      disabled={sendingId === lead.id || !lead.email}
                      title="Enviar email de presentación (primera campaña gratis)"
                      className="inline-flex items-center justify-center h-7 w-7 rounded-lg border border-violet-200 bg-violet-50 text-violet-600 hover:bg-violet-100 disabled:opacity-40"
                    >
                      {sendingId === lead.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-gray-400">
        <span>Página {page} de {totalPages}</span>
        <div className="flex gap-2">
          <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-40">Anterior</button>
          <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-40">Siguiente</button>
        </div>
      </div>
    </div>
  )
}
