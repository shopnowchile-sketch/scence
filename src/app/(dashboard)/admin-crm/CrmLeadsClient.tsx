'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { Search, Loader2, Building2, CheckCircle2, Circle, Mail, Plus, X, Upload, Trash2, Columns3 } from 'lucide-react'
import { cn, formatDate } from '@/lib/utils'
import { toast } from 'sonner'
import { useLocalStorageState } from '@/hooks/useLocalStorageState'

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
  email_opened: boolean
  email_opened_at: string | null
}

type LeadForm = {
  company_name: string
  contact_name: string
  email: string
  phone_1: string
  commune: string
  region: string
  industry: string
  source: string
}

const EMPTY_FORM: LeadForm = {
  company_name: '',
  contact_name: '',
  email: '',
  phone_1: '',
  commune: '',
  region: '',
  industry: '',
  source: 'manual',
}

const STATUS_CONFIG: Record<Lead['qualification_status'], { label: string; cls: string }> = {
  unqualified: { label: 'Sin calificar', cls: 'bg-gray-100 text-gray-500' },
  qualified:   { label: 'Califica',      cls: 'bg-green-100 text-green-700' },
  rejected:    { label: 'No califica',   cls: 'bg-red-100 text-red-600' },
  contacted:   { label: 'Contactado',    cls: 'bg-blue-100 text-blue-700' },
  converted:   { label: 'Convertido',    cls: 'bg-violet-100 text-violet-700' },
}

type ColumnKey = 'contact' | 'location' | 'industry' | 'source' | 'qualification' | 'last_email' | 'email_opened' | 'connected' | 'action'

type EmailStats = {
  sent: number
  delivered: number
  opened: number
  failed: number
  bounced: number
  openRate: number
}

const COLUMN_CONFIG: { key: ColumnKey; label: string }[] = [
  { key: 'contact', label: 'Contacto' },
  { key: 'location', label: 'Ubicación' },
  { key: 'industry', label: 'Rubro' },
  { key: 'source', label: 'Origen' },
  { key: 'qualification', label: 'Calificación' },
  { key: 'last_email', label: 'Último email' },
  { key: 'email_opened', label: 'Abrió email' },
  { key: 'connected', label: 'Conectado' },
  { key: 'action', label: 'Acción' },
]

const DEFAULT_COLUMNS: ColumnKey[] = COLUMN_CONFIG.map(c => c.key)

export function CrmLeadsClient() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [qualification, setQualification] = useState('')
  const [source, setSource] = useState('')
  const [industry, setIndustry] = useState('')
  const [commune, setCommune] = useState('')
  const [emailStatus, setEmailStatus] = useState('')
  const [sources, setSources] = useState<string[]>([])
  const [visibleColumns, setVisibleColumns] = useLocalStorageState<ColumnKey[]>(
    'scence:admin:crm:visibleColumns', DEFAULT_COLUMNS
  )
  const [showColumnsMenu, setShowColumnsMenu] = useState(false)
  const [industries, setIndustries] = useState<string[]>([])
  const [communes, setCommunes] = useState<string[]>([])
  const [stats, setStats] = useState<EmailStats>({ sent: 0, delivered: 0, opened: 0, failed: 0, bounced: 0, openRate: 0 })
  const [showAddModal, setShowAddModal] = useState(false)
  const [savingLead, setSavingLead] = useState(false)
  const [form, setForm] = useState<LeadForm>(EMPTY_FORM)
  const [showImportModal, setShowImportModal] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [selectingAll, setSelectingAll] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [showBulkSendModal, setShowBulkSendModal] = useState(false)
  const [bulkSubject, setBulkSubject] = useState('Hola, ¿cómo estás?')
  const [bulkMessage, setBulkMessage] = useState(`Hola,

Soy Pri, fundadora de SCENCE.

Hoy las marcas ya no crecen solo con publicidad tradicional. Las personas quieren contenido real, recomendaciones auténticas y marcas que les generen confianza.

Por eso creamos SCENCE: una plataforma chilena que conecta marcas con creadoras de contenido e influencers para crear campañas, eventos, canjes y contenido UGC que ayude a aumentar visibilidad, seguidores, confianza y ventas.

Queremos invitarte a probar SCENCE y registrar tu marca para que podamos ayudarte a conectar con creadoras alineadas a tu estilo, tu público y tus objetivos.

Esta nueva forma de potenciar marcas ya se está usando en Estados Unidos y en el mundo. En Chile, SCENCE está creciendo para ayudar a emprendedores y empresas a adaptarse a lo que hoy sí genera impacto: contenido real, comunidad y confianza.

Puedes registrarte aquí:
https://scence-app.vercel.app/register

También puedes revisar nuestros Instagram:
@influencers.snc — https://www.instagram.com/influencers.snc/
@scence.cl — https://www.instagram.com/scence.cl/

Si quieres más información, también me puedes escribir directo a:
pri@scence.cl

Nos encantaría ayudarte a crecer tu marca con creadoras.

Saludos,
Pri
SCENCE`)
  const [sendingBulk, setSendingBulk] = useState(false)
  const limit = 50
  const tableRef = useRef<HTMLDivElement>(null)

  function goToEmailStatus(value: string) {
    setEmailStatus(value)
    setPage(1)
    requestAnimationFrame(() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), limit: String(limit) })
    if (search) params.set('search', search)
    if (qualification) params.set('qualification', qualification)
    if (source) params.set('source', source)
    if (industry) params.set('industry', industry)
    if (commune) params.set('commune', commune)
    if (emailStatus) params.set('email_status', emailStatus)
    try {
      const r = await fetch(`/api/crm-leads?${params}`)
      const j = await r.json()
      const nextLeads = j.data ?? []
      setLeads(nextLeads)
      setSelectedIds(prev => prev.filter(id => nextLeads.some((lead: Lead) => lead.id === id)))
      setTotal(j.total ?? 0)
      if (j.stats) setStats(j.stats)
      if (Array.isArray(j.sources)) setSources(j.sources)
      if (Array.isArray(j.industries)) setIndustries(j.industries)
      if (Array.isArray(j.communes)) setCommunes(j.communes)
    } catch {
      toast.error('Error cargando leads')
    }
    setLoading(false)
  }, [page, search, qualification, source, industry, commune, emailStatus])

  useEffect(() => { load() }, [load])

  function updateForm<K extends keyof LeadForm>(key: K, value: LeadForm[K]) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  async function createLead() {
    if (!form.company_name.trim() && !form.email.trim()) {
      toast.error('Ingresa al menos empresa o email')
      return
    }

    setSavingLead(true)
    try {
      const r = await fetch('/api/crm-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? 'No se pudo crear el lead')

      toast.success('Lead creado')
      setShowAddModal(false)
      setForm(EMPTY_FORM)
      setPage(1)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo crear el lead')
    } finally {
      setSavingLead(false)
    }
  }

  const visibleLeadIds = leads.map(lead => lead.id)
  const selectedCount = selectedIds.length
  const allVisibleSelected = visibleLeadIds.length > 0 && visibleLeadIds.every(id => selectedIds.includes(id))

  function toggleLead(id: string) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  function toggleAllVisible() {
    setSelectedIds(prev => {
      if (allVisibleSelected) return prev.filter(id => !visibleLeadIds.includes(id))
      return Array.from(new Set([...prev, ...visibleLeadIds]))
    })
  }

  async function selectAllMatching() {
    setSelectingAll(true)
    try {
      const params = new URLSearchParams({ ids_only: '1' })
      if (search) params.set('search', search)
      if (qualification) params.set('qualification', qualification)
      if (source) params.set('source', source)
      if (industry) params.set('industry', industry)
      if (commune) params.set('commune', commune)
      if (emailStatus) params.set('email_status', emailStatus)
      const r = await fetch(`/api/crm-leads?${params}`)
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? 'No se pudo seleccionar todos')
      const ids = j.ids ?? []
      setSelectedIds(ids)
      toast.success(`${ids.length} lead${ids.length === 1 ? '' : 's'} seleccionado${ids.length === 1 ? '' : 's'}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo seleccionar todos')
    } finally {
      setSelectingAll(false)
    }
  }

  async function sendBulkEmails() {
    if (selectedIds.length === 0) {
      toast.error('No hay leads seleccionados')
      return
    }

    setSendingBulk(true)
    try {
      const r = await fetch('/api/crm-leads/bulk-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_ids: selectedIds,
          subject: bulkSubject,
          message: bulkMessage,
        }),
      })

      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? 'No se pudieron enviar los emails')

      toast.success(`Envío en marcha: ${j.total} leads. Te llega un email cuando termine.`)
      setShowBulkSendModal(false)
      setBulkSubject('Hola, ¿cómo estás?')
      setBulkMessage(`Hola,

Soy Pri, fundadora de SCENCE.

Hoy las marcas ya no crecen solo con publicidad tradicional. Las personas quieren contenido real, recomendaciones auténticas y marcas que les generen confianza.

Por eso creamos SCENCE: una plataforma chilena que conecta marcas con creadoras de contenido e influencers para crear campañas, eventos, canjes y contenido UGC que ayude a aumentar visibilidad, seguidores, confianza y ventas.

Queremos invitarte a probar SCENCE y registrar tu marca para que podamos ayudarte a conectar con creadoras alineadas a tu estilo, tu público y tus objetivos.

Esta nueva forma de potenciar marcas ya se está usando en Estados Unidos y en el mundo. En Chile, SCENCE está creciendo para ayudar a emprendedores y empresas a adaptarse a lo que hoy sí genera impacto: contenido real, comunidad y confianza.

Puedes registrarte aquí:
https://scence-app.vercel.app/register

También puedes revisar nuestros Instagram:
@influencers.snc — https://www.instagram.com/influencers.snc/
@scence.cl — https://www.instagram.com/scence.cl/

Si quieres más información, también me puedes escribir directo a:
pri@scence.cl

Nos encantaría ayudarte a crecer tu marca con creadoras.

Saludos,
Pri
SCENCE`)
      setSelectedIds([])
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudieron enviar los emails')
    } finally {
      setSendingBulk(false)
    }
  }

  async function deleteSelectedLeads() {
    if (deleteConfirm !== 'ELIMINAR') {
      toast.error('Debes escribir ELIMINAR')
      return
    }

    setDeleting(true)
    try {
      const r = await fetch('/api/crm-leads/bulk-delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_ids: selectedIds }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? 'No se pudieron eliminar los leads')

      toast.success(`Leads eliminados: ${j.deleted}`)
      setSelectedIds([])
      setDeleteConfirm('')
      setShowDeleteModal(false)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudieron eliminar los leads')
    } finally {
      setDeleting(false)
    }
  }

  function isColumnVisible(key: ColumnKey) {
    return visibleColumns.includes(key)
  }

  function toggleColumn(key: ColumnKey) {
    setVisibleColumns(prev => (
      prev.includes(key)
        ? prev.filter(k => k !== key)
        : [...prev, key]
    ))
  }

  function resetColumns() {
    setVisibleColumns(DEFAULT_COLUMNS)
  }

  async function importLeads() {
    if (!importFile) {
      toast.error('Selecciona un archivo CSV')
      return
    }

    setImporting(true)
    try {
      const formData = new FormData()
      formData.append('file', importFile)

      const r = await fetch('/api/crm-leads/import', {
        method: 'POST',
        body: formData,
      })

      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? 'No se pudo importar')

      toast.success(`Importados: ${j.imported} · Duplicados: ${j.duplicates} · Inválidos: ${j.invalid}`)
      if (j.limited_to_500) toast.warning('Se importaron máximo 500 filas por seguridad')

      setShowImportModal(false)
      setImportFile(null)
      setPage(1)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo importar')
    } finally {
      setImporting(false)
    }
  }

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

  const totalPages = Math.max(1, Math.ceil(total / limit))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">CRM — Prospectos</h1>
          <p className="text-sm text-gray-400">{total.toLocaleString('es-CL')} empresas cargadas · calificar y contactar</p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 w-full">
          <button
            type="button"
            onClick={() => goToEmailStatus('sent')}
            className="text-left rounded-xl border border-gray-200 bg-white p-4 hover:border-violet-300 hover:bg-violet-50/40 transition-colors"
          >
            <p className="text-xs text-gray-500">Enviados</p>
            <p className="text-2xl font-bold text-gray-900">{stats.sent.toLocaleString('es-CL')}</p>
          </button>
          <button
            type="button"
            onClick={() => goToEmailStatus('delivered')}
            className="text-left rounded-xl border border-gray-200 bg-white p-4 hover:border-violet-300 hover:bg-violet-50/40 transition-colors"
          >
            <p className="text-xs text-gray-500">Entregados</p>
            <p className="text-2xl font-bold text-gray-900">{stats.delivered.toLocaleString('es-CL')}</p>
          </button>
          <button
            type="button"
            onClick={() => goToEmailStatus('opened')}
            className="text-left rounded-xl border border-gray-200 bg-white p-4 hover:border-violet-300 hover:bg-violet-50/40 transition-colors"
          >
            <p className="text-xs text-gray-500">Abiertos</p>
            <p className="text-2xl font-bold text-gray-900">{stats.opened.toLocaleString('es-CL')}</p>
          </button>
          <button
            type="button"
            onClick={() => goToEmailStatus('opened')}
            className="text-left rounded-xl border border-gray-200 bg-white p-4 hover:border-violet-300 hover:bg-violet-50/40 transition-colors"
          >
            <p className="text-xs text-gray-500">Tasa apertura</p>
            <p className="text-2xl font-bold text-gray-900">{stats.openRate}%</p>
          </button>
          <button
            type="button"
            onClick={() => goToEmailStatus('failed_bounced')}
            className="text-left rounded-xl border border-gray-200 bg-white p-4 hover:border-violet-300 hover:bg-violet-50/40 transition-colors"
          >
            <p className="text-xs text-gray-500">Fallidos/Rebotados</p>
            <p className="text-2xl font-bold text-gray-900">{(stats.failed + stats.bounced).toLocaleString('es-CL')}</p>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowColumnsMenu(v => !v)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-700 text-sm font-semibold hover:bg-gray-50"
            >
              <Columns3 className="h-4 w-4" />
              Columnas
            </button>

            {showColumnsMenu && (
              <div className="absolute right-0 mt-2 w-56 bg-white border border-gray-100 rounded-2xl shadow-xl z-30 p-2">
                <div className="px-3 py-2 border-b border-gray-50">
                  <p className="text-xs font-bold text-gray-900">Mostrar columnas</p>
                  <p className="text-[11px] text-gray-400">Empresa siempre queda visible.</p>
                </div>

                <div className="py-2 space-y-1">
                  {COLUMN_CONFIG.map(col => (
                    <label key={col.key} className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-gray-50 cursor-pointer text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={visibleColumns.includes(col.key)}
                        onChange={() => toggleColumn(col.key)}
                        className="h-4 w-4 rounded border-gray-300 text-violet-600"
                      />
                      {col.label}
                    </label>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={resetColumns}
                  className="w-full px-3 py-2 rounded-xl bg-gray-50 text-xs font-semibold text-gray-600 hover:bg-gray-100"
                >
                  Restaurar columnas
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowImportModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-700 text-sm font-semibold hover:bg-gray-50"
          >
            <Upload className="h-4 w-4" />
            Importar leads
          </button>

          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700"
          >
            <Plus className="h-4 w-4" />
            Agregar lead
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-100 bg-white p-3">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-12 gap-2">
          <div className="relative xl:col-span-5">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <input
              value={search}
              onChange={e => { setPage(1); setSearch(e.target.value) }}
              placeholder="Buscar por empresa, contacto o email..."
              className="h-9 w-full pl-8 pr-3 rounded-lg border border-gray-200 bg-white text-xs outline-none focus:border-violet-400"
            />
          </div>

          <div className="xl:col-span-3">
            <select
              value={qualification}
              onChange={e => { setPage(1); setQualification(e.target.value) }}
              className="h-9 w-full px-3 rounded-lg border border-gray-200 bg-white text-xs text-gray-700 outline-none focus:border-violet-400"
            >
              <option value="">Todos los estados</option>
              {Object.entries(STATUS_CONFIG).map(([k, cfg]) => (
                <option key={k} value={k}>{cfg.label}</option>
              ))}
            </select>
          </div>

          <div className="xl:col-span-4">
            <select
              value={industry}
              onChange={e => { setPage(1); setIndustry(e.target.value) }}
              className="h-9 w-full px-3 rounded-lg border border-gray-200 bg-white text-xs text-gray-700 outline-none focus:border-violet-400"
            >
              <option value="">Todos los rubros</option>
              {industries.map(i => (
                <option key={i} value={i}>{i}</option>
              ))}
            </select>
          </div>

          <div className="xl:col-span-4">
            <select
              value={commune}
              onChange={e => { setPage(1); setCommune(e.target.value) }}
              className="h-9 w-full px-3 rounded-lg border border-gray-200 bg-white text-xs text-gray-700 outline-none focus:border-violet-400"
            >
              <option value="">Todas las comunas</option>
              {communes.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div className="xl:col-span-4">
            <select
              value={emailStatus}
              onChange={e => { setPage(1); setEmailStatus(e.target.value) }}
              className="h-9 w-full px-3 rounded-lg border border-gray-200 bg-white text-xs text-gray-700 outline-none focus:border-violet-400"
            >
              <option value="">Todos los emails</option>
              <option value="sent">Enviados</option>
              <option value="delivered">Entregados</option>
              <option value="opened">Abiertos</option>
              <option value="failed">Fallidos</option>
              <option value="bounced">Rebotados</option>
              <option value="failed_bounced">Fallidos o rebotados</option>
              <option value="not_sent">Sin email enviado</option>
            </select>
          </div>

          <div className="xl:col-span-4">
            <select
              value={source}
              onChange={e => { setPage(1); setSource(e.target.value) }}
              className="h-9 w-full px-3 rounded-lg border border-gray-200 bg-white text-xs text-gray-700 outline-none focus:border-violet-400"
            >
              <option value="">Todos los orígenes</option>
              {sources.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div className="xl:col-span-4 flex items-center">
            <button
              type="button"
              onClick={() => {
                setSearch('')
                setQualification('')
                setIndustry('')
                setCommune('')
                setSource('')
                setEmailStatus('')
                setPage(1)
              }}
              className="h-9 px-3 rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-600 hover:bg-gray-50"
            >
              Limpiar filtros
            </button>
          </div>

          {total > 0 && (
            <div className="xl:col-span-4 flex items-center">
              <button
                type="button"
                onClick={selectAllMatching}
                disabled={selectingAll || selectedIds.length === total}
                className="h-9 px-3 rounded-lg border border-violet-200 bg-violet-50 text-xs font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-50"
              >
                {selectingAll
                  ? 'Seleccionando...'
                  : selectedIds.length === total
                    ? `Todos (${total}) seleccionados`
                    : `Seleccionar todos (${total})`}
              </button>
            </div>
          )}
        </div>
      </div>

      {selectedCount > 0 && (
        <div className="bg-violet-50 border border-violet-100 rounded-2xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-semibold text-violet-700">
              {selectedCount} lead{selectedCount === 1 ? '' : 's'} seleccionado{selectedCount === 1 ? '' : 's'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedIds([])}
              className="px-3 py-2 rounded-xl border border-violet-200 bg-white text-violet-700 text-sm font-semibold hover:bg-violet-50"
            >
              Limpiar selección
            </button>
            <button
              type="button"
              onClick={() => setShowBulkSendModal(true)}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700"
            >
              <Mail className="h-4 w-4" />
              Enviar email
            </button>

            <button
              type="button"
              onClick={() => setShowDeleteModal(true)}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700"
            >
              <Trash2 className="h-4 w-4" />
              Eliminar seleccionadas
            </button>
          </div>
        </div>
      )}

      <div ref={tableRef} className="bg-white rounded-2xl border border-gray-100 overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead>
            <tr className="border-b border-gray-50 text-left text-xs text-gray-400">
              <th className="px-4 py-3 font-semibold w-10">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleAllVisible}
                  className="h-4 w-4 rounded border-gray-300 text-violet-600"
                />
              </th>
              <th className="px-4 py-3 font-semibold">Empresa</th>
              {isColumnVisible('contact') && <th className="px-4 py-3 font-semibold">Contacto</th>}
              {isColumnVisible('location') && <th className="px-4 py-3 font-semibold">Ubicación</th>}
              {isColumnVisible('industry') && <th className="px-4 py-3 font-semibold">Rubro</th>}
              {isColumnVisible('source') && <th className="px-4 py-3 font-semibold">Origen</th>}
              {isColumnVisible('qualification') && <th className="px-4 py-3 font-semibold">Calificación</th>}
              {isColumnVisible('last_email') && <th className="px-4 py-3 font-semibold">Último email</th>}
              {isColumnVisible('email_opened') && <th className="px-4 py-3 font-semibold">Abrió email</th>}
              {isColumnVisible('connected') && <th className="px-4 py-3 font-semibold">Conectado</th>}
              {isColumnVisible('action') && <th className="px-4 py-3 font-semibold text-right">Acción</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className="px-4 py-10 text-center text-gray-400">Cargando…</td></tr>
            ) : leads.length === 0 ? (
              <tr><td colSpan={10} className="px-4 py-10 text-center text-gray-400">Sin resultados</td></tr>
            ) : leads.map(lead => {
              const cfg = STATUS_CONFIG[lead.qualification_status] ?? STATUS_CONFIG.unqualified
              return (
                <tr key={lead.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(lead.id)}
                      onChange={() => toggleLead(lead.id)}
                      className="h-4 w-4 rounded border-gray-300 text-violet-600"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/admin-crm/${lead.id}`} className="flex items-center gap-2 font-medium text-gray-900 hover:text-violet-600">
                      <Building2 className="h-3.5 w-3.5 text-gray-300 flex-shrink-0" />
                      <span className="truncate max-w-[200px]">{lead.company_name || '—'}</span>
                    </Link>
                  </td>
{isColumnVisible('contact') && (
                  <td className="px-4 py-3 text-gray-600">
                    <div className="truncate max-w-[180px]">{lead.contact_name || '—'}</div>
                    <div className="text-xs text-gray-400 truncate max-w-[180px]">{lead.email}</div>
                  </td>
                  )}
{isColumnVisible('location') && <td className="px-4 py-3 text-gray-500 text-xs">{lead.commune || '—'}</td>}
{isColumnVisible('industry') && <td className="px-4 py-3 text-gray-500 text-xs truncate max-w-[160px]">{lead.industry || '—'}</td>}
{isColumnVisible('source') && (
                  <td className="px-4 py-3 text-gray-500 text-xs truncate max-w-[140px]" title={lead.source ?? undefined}>
                    {lead.source || '—'}
                  </td>
                  )}
{isColumnVisible('qualification') && (
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
                  )}
{isColumnVisible('last_email') && (
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {lead.contacted_at ? new Date(lead.contacted_at).toLocaleDateString('es-CL') : 'Nunca'}
                  </td>
                  )}

                  {isColumnVisible('email_opened') && (
                  <td className="px-4 py-3 text-xs">
                    {lead.email_opened ? (
                      <span className="inline-flex items-center gap-1 text-emerald-600" title={lead.email_opened_at ? `Abrió: ${formatDate(lead.email_opened_at, "d MMM yyyy HH:mm")}` : undefined}>
                        <CheckCircle2 className="h-3.5 w-3.5" /> Sí
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-gray-300">
                        <Circle className="h-3.5 w-3.5" /> No
                      </span>
                    )}
                  </td>
                  )}
{isColumnVisible('connected') && (
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
                  )}
{isColumnVisible('action') && (
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin-crm/${lead.id}`}
                      title="Revisar y enviar email"
                      className="inline-flex items-center justify-center h-7 w-7 rounded-lg border border-violet-200 bg-violet-50 text-violet-600 hover:bg-violet-100"
                    >
                      <Mail className="h-3.5 w-3.5" />
                    </Link>
                  </td>
                  )}
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

      {showBulkSendModal && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl border border-gray-100">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div>
                <h2 className="text-base font-bold text-gray-900">Enviar email masivo</h2>
                <p className="text-xs text-gray-400">Se enviará a los leads seleccionados que tengan email, en tandas en background. Te llega un email cuando termine.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowBulkSendModal(false)}
                className="h-8 w-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-400 hover:text-gray-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="rounded-xl bg-violet-50 border border-violet-100 p-4 text-sm text-violet-700 font-semibold">
                {selectedCount} lead{selectedCount === 1 ? '' : 's'} seleccionado{selectedCount === 1 ? '' : 's'}
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Asunto</label>
                <input
                  value={bulkSubject}
                  onChange={e => setBulkSubject(e.target.value)}
                  placeholder="Hola, ¿cómo estás?"
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm outline-none focus:border-violet-400"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">
                  Mensaje personalizado opcional
                </label>
                <textarea
                  value={bulkMessage}
                  onChange={e => setBulkMessage(e.target.value)}
                  placeholder="Edita el mensaje antes de enviar si quieres personalizarlo."
                  rows={8}
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm outline-none focus:border-violet-400 resize-none"
                />
                <p className="mt-1 text-xs text-gray-400">
                  Este mensaje se enviará a todos los leads seleccionados. Puedes editarlo antes de enviar.
                </p>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowBulkSendModal(false)}
                className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={sendingBulk || selectedCount === 0}
                onClick={sendBulkEmails}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50"
              >
                {sendingBulk && <Loader2 className="h-4 w-4 animate-spin" />}
                Enviar emails
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteModal && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-gray-100">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div>
                <h2 className="text-base font-bold text-gray-900">Eliminar leads permanentemente</h2>
                <p className="text-xs text-red-500 font-semibold">Esta acción no se puede deshacer.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                className="h-8 w-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-400 hover:text-gray-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <p className="text-sm text-gray-600">
                Vas a eliminar permanentemente {selectedCount} lead{selectedCount === 1 ? '' : 's'} del CRM.
              </p>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">
                  Escribe ELIMINAR para confirmar
                </label>
                <input
                  value={deleteConfirm}
                  onChange={e => setDeleteConfirm(e.target.value)}
                  placeholder="ELIMINAR"
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm outline-none focus:border-red-400"
                />
              </div>
            </div>

            <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={deleting || deleteConfirm !== 'ELIMINAR'}
                onClick={deleteSelectedLeads}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50"
              >
                {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
                Eliminar permanentemente
              </button>
            </div>
          </div>
        </div>
      )}

      {showImportModal && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-white rounded-2xl shadow-xl border border-gray-100">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div>
                <h2 className="text-base font-bold text-gray-900">Importar leads</h2>
                <p className="text-xs text-gray-400">Sube un CSV con máximo 500 filas.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="h-8 w-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-400 hover:text-gray-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="rounded-xl bg-gray-50 border border-gray-100 p-4 text-xs text-gray-500 leading-relaxed">
                Columnas aceptadas: empresa, email, teléfono, contacto, comuna, región, rubro, origen.
                También acepta: company_name, contact_name, phone_1, commune, region, industry, source.
              </div>

              <input
                type="file"
                accept=".csv,text/csv"
                onChange={e => setImportFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-gray-600 file:mr-4 file:rounded-xl file:border-0 file:bg-violet-50 file:px-4 file:py-2.5 file:text-sm file:font-semibold file:text-violet-700 hover:file:bg-violet-100"
              />

              {importFile && (
                <p className="text-xs text-gray-400">Archivo seleccionado: {importFile.name}</p>
              )}
            </div>

            <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={importing || !importFile}
                onClick={importLeads}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50"
              >
                {importing && <Loader2 className="h-4 w-4 animate-spin" />}
                Importar
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl border border-gray-100">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div>
                <h2 className="text-base font-bold text-gray-900">Agregar lead</h2>
                <p className="text-xs text-gray-400">Crea una empresa manualmente en el CRM.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="h-8 w-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-400 hover:text-gray-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-3">
              <input value={form.company_name} onChange={e => updateForm('company_name', e.target.value)} placeholder="Empresa / razón social" className="px-3 py-2.5 rounded-xl border border-gray-200 text-sm outline-none focus:border-violet-400" />
              <input value={form.contact_name} onChange={e => updateForm('contact_name', e.target.value)} placeholder="Contacto" className="px-3 py-2.5 rounded-xl border border-gray-200 text-sm outline-none focus:border-violet-400" />
              <input value={form.email} onChange={e => updateForm('email', e.target.value)} placeholder="Email" className="px-3 py-2.5 rounded-xl border border-gray-200 text-sm outline-none focus:border-violet-400" />
              <input value={form.phone_1} onChange={e => updateForm('phone_1', e.target.value)} placeholder="Teléfono" className="px-3 py-2.5 rounded-xl border border-gray-200 text-sm outline-none focus:border-violet-400" />
              <input value={form.commune} onChange={e => updateForm('commune', e.target.value)} placeholder="Comuna / ciudad" className="px-3 py-2.5 rounded-xl border border-gray-200 text-sm outline-none focus:border-violet-400" />
              <input value={form.region} onChange={e => updateForm('region', e.target.value)} placeholder="Región" className="px-3 py-2.5 rounded-xl border border-gray-200 text-sm outline-none focus:border-violet-400" />
              <input value={form.industry} onChange={e => updateForm('industry', e.target.value)} placeholder="Rubro / categoría" className="px-3 py-2.5 rounded-xl border border-gray-200 text-sm outline-none focus:border-violet-400" />
              <input value={form.source} onChange={e => updateForm('source', e.target.value)} placeholder="Origen" className="px-3 py-2.5 rounded-xl border border-gray-200 text-sm outline-none focus:border-violet-400" />
            </div>

            <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={savingLead}
                onClick={createLead}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50"
              >
                {savingLead && <Loader2 className="h-4 w-4 animate-spin" />}
                Guardar lead
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
