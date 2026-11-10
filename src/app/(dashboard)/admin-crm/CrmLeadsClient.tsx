'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { Search, Loader2, Building2, CheckCircle2, Circle, Mail, Plus, X, Upload, Trash2, Columns3 } from 'lucide-react'
import { cn, formatDate } from '@/lib/utils'
import { toast } from 'sonner'
import { useLocalStorageState } from '@/hooks/useLocalStorageState'
import { CRM_EMAIL_CATALOG } from '@/lib/email-catalog'
import { CRM_NICHE_SOURCES } from '@/lib/crm-niches'
import { CrmLocationFields } from '@/components/locations/CrmLocationFields'
import CommuneMultiSelect from './CommuneMultiSelect'
import AttachmentPicker, { type CrmAttachment } from './AttachmentPicker'

type Lead = {
  id: string
  subscription?: 'subscribed' | 'unconfirmed' | 'unsubscribed' | 'blocked' | 'no_email'
  lead_type?: 'influencer' | 'customer' | 'brand' | 'other'
  contact_name: string | null
  company_name: string | null
  email: string | null
  phone_1: string | null
  instagram: string | null
  contact_rut?: string | null
  commune: string | null
  region: string | null
  country?: string | null
  industry: string | null
  company_size: string | null
  employee_count: string | null
  qualification_status: LeadStatus
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
  instagram: string
  country: string
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
  instagram: '',
  country: '',
  commune: '',
  region: '',
  industry: '',
  source: 'manual',
}

type LeadStatus = 'unqualified' | 'qualified' | 'rejected' | 'contacted' | 'interested' | 'building' | 'converted'

const STATUS_CONFIG: Record<LeadStatus, { label: string; cls: string }> = {
  unqualified: { label: 'Sin calificar',    cls: 'bg-gray-100 text-gray-500' },
  contacted:   { label: 'Contactada',       cls: 'bg-blue-100 text-blue-700' },
  interested:  { label: 'Interesada',       cls: 'bg-amber-100 text-amber-700' },
  building:    { label: 'Armando campaña',  cls: 'bg-indigo-100 text-indigo-700' },
  converted:   { label: 'Cerrada',          cls: 'bg-violet-100 text-violet-700' },
  rejected:    { label: 'Descartada',       cls: 'bg-red-100 text-red-600' },
  qualified:   { label: 'Califica (legado)', cls: 'bg-green-100 text-green-700' },
}

// Orden del pipeline comercial. `qualified` queda fuera: es un estado legado que
// se sigue mostrando si un lead lo tiene, pero ya no se ofrece para elegir.
const PIPELINE_STATUSES: LeadStatus[] = ['unqualified', 'contacted', 'interested', 'building', 'converted', 'rejected']

function statusOptions(current: LeadStatus): LeadStatus[] {
  return PIPELINE_STATUSES.includes(current) ? PIPELINE_STATUSES : [...PIPELINE_STATUSES, current]
}

type ColumnKey = 'contact' | 'rut' | 'type' | 'subscription' | 'instagram' | 'country' | 'region' | 'commune' | 'industry' | 'source' | 'qualification' | 'last_email' | 'email_opened' | 'connected' | 'action'

type EmailStats = {
  sent: number
  delivered: number
  opened: number
  clicked: number
  failed: number
  bounced: number
  openRate: number
}

const COLUMN_CONFIG: { key: ColumnKey; label: string }[] = [
  { key: 'contact', label: 'Contacto' },
  { key: 'rut', label: 'RUT' },
  { key: 'type', label: 'Tipo' },
  { key: 'subscription', label: 'Suscripción' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'country', label: 'País' },
  { key: 'region', label: 'Región / Estado' },
  { key: 'commune', label: 'Comuna / Ciudad' },
  { key: 'industry', label: 'Rubro' },
  { key: 'source', label: 'Origen' },
  { key: 'qualification', label: 'Calificación' },
  { key: 'last_email', label: 'Último email' },
  { key: 'email_opened', label: 'Abrió email' },
  { key: 'connected', label: 'Conectado' },
  { key: 'action', label: 'Acción' },
]

const DEFAULT_COLUMNS: ColumnKey[] = COLUMN_CONFIG.map(c => c.key)
const DEFAULT_CRM_TEMPLATE = CRM_EMAIL_CATALOG.find(template => template.key === 'crm_intro') ?? CRM_EMAIL_CATALOG[0]

export function CrmLeadsClient() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [qualification, setQualification] = useState('')
  const [selectedCommunes, setSelectedCommunes] = useState<string[]>([])
  const [source, setSource] = useState('')
  const [emailStatus, setEmailStatus] = useState('')
  const [contactData, setContactData] = useState('')
  // Por defecto solo Chile (los demás países se ven eligiendo «Todos los países»).
  const [extra, setExtra] = useState<Record<string, string>>({ country: 'Chile' })
  // País → Región → Comuna: solo valores que existen hoy en los leads (guardados contra el catálogo `locations`).
  const [geo, setGeo] = useState<Record<string, Record<string, string[]>>>({})
  const [sort, setSort] = useLocalStorageState<{ key: string; dir: 'asc' | 'desc' }>('scence:admin:crm:sort:v2', { key: 'priority', dir: 'desc' })
  const [showMore, setShowMore] = useState(false)
  const [campaigns, setCampaigns] = useState<Array<{ id: string; name: string }>>([])
  const [visibleColumns, setVisibleColumns] = useLocalStorageState<ColumnKey[]>(
    'scence:admin:crm:visibleColumns:v3', DEFAULT_COLUMNS
  )
  const [showColumnsMenu, setShowColumnsMenu] = useState(false)
  const [communes, setCommunes] = useState<string[]>([])
  const [sources, setSources] = useState<string[]>([])
  const [stats, setStats] = useState<EmailStats>({ sent: 0, delivered: 0, opened: 0, clicked: 0, failed: 0, bounced: 0, openRate: 0 })
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
  const [bulkTemplateKey, setBulkTemplateKey] = useState(DEFAULT_CRM_TEMPLATE.key)
  const [bulkSubject, setBulkSubject] = useState(DEFAULT_CRM_TEMPLATE.defaultSubject)
  const [bulkMessage, setBulkMessage] = useState(DEFAULT_CRM_TEMPLATE.defaultMessage ?? '')
  const [bulkAttachment, setBulkAttachment] = useState<CrmAttachment | null>(null)
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
    selectedCommunes.forEach(c => params.append('commune', c))
    if (source) params.set('source', source)
    if (emailStatus) params.set('email_status', emailStatus)
    if (contactData) params.set('contact_data', contactData)
    params.set('sort', sort.key); params.set('order', sort.dir)
    Object.entries(extra).forEach(([k, v]) => { if (v) params.set(k, v) })
    try {
      const r = await fetch(`/api/crm-leads?${params}`)
      const j = await r.json()
      const nextLeads = j.data ?? []
      setLeads(nextLeads)
      setTotal(j.total ?? 0)
      if (j.stats) setStats(j.stats)
      if (j.geo) setGeo(j.geo)
      if (Array.isArray(j.communes)) setCommunes(j.communes)
      // Si la comuna elegida ya no tiene leads (desapareció de la lista), se quita el filtro.
      if (nextLeads.length === 0 && Array.isArray(j.communes)) {
        const valid = selectedCommunes.filter(c => j.communes.includes(c))
        if (valid.length !== selectedCommunes.length) setSelectedCommunes(valid)
      }
      if (Array.isArray(j.sources)) setSources(j.sources)
      if (Array.isArray(j.campaigns)) setCampaigns(j.campaigns)
    } catch {
      toast.error('Error cargando leads')
    }
    setLoading(false)
  }, [page, search, qualification, selectedCommunes, source, emailStatus, contactData, extra, sort])

  useEffect(() => { load() }, [load])

  const geoCountries = Object.keys(geo).filter(Boolean).sort((x, y) => x.localeCompare(y, 'es'))
  const geoRegions = extra.country ? Object.keys(geo[extra.country] ?? {}).filter(Boolean).sort((x, y) => x.localeCompare(y, 'es')) : []
  const geoCommunes = extra.country && extra.region ? geo[extra.country]?.[extra.region] ?? [] : []

  function chooseCountry(name: string) {
    setPage(1); setSelectedCommunes([])
    setExtra(prev => ({ ...prev, country: name, region: '' }))
  }
  function chooseRegion(name: string) {
    setPage(1); setSelectedCommunes([])
    setExtra(prev => ({ ...prev, region: name }))
  }

  // Cambiar de página conserva una selección global. Cambiar los filtros la
  // reinicia para que nunca se envíe a destinatarios de una búsqueda anterior.
  useEffect(() => { setSelectedIds([]) }, [search, qualification, selectedCommunes, source, emailStatus, contactData, extra])

  function updateForm<K extends keyof LeadForm>(key: K, value: LeadForm[K]) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  async function createLead() {
    if (!form.company_name.trim() && !form.email.trim() && !form.instagram.trim()) {
      toast.error('Ingresa al menos empresa, email o Instagram')
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

  const selectedCount = selectedIds.length
  const allMatchingSelected = total > 0 && selectedCount === total

  function toggleLead(id: string) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function selectAllMatching() {
    setSelectingAll(true)
    try {
      const params = new URLSearchParams({ ids_only: '1' })
      if (search) params.set('search', search)
      if (qualification) params.set('qualification', qualification)
      selectedCommunes.forEach(c => params.append('commune', c))
      if (source) params.set('source', source)
      if (emailStatus) params.set('email_status', emailStatus)
      if (contactData) params.set('contact_data', contactData)
      Object.entries(extra).forEach(([k, v]) => { if (v) params.set(k, v) })
      const r = await fetch(`/api/crm-leads?${params}`)
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? 'No se pudo seleccionar todos')
      const ids = Array.from(new Set<string>(j.ids ?? []))
      setSelectedIds(ids)
      toast.success(`${ids.length} lead${ids.length === 1 ? '' : 's'} seleccionado${ids.length === 1 ? '' : 's'}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo seleccionar todos')
    } finally {
      setSelectingAll(false)
    }
  }

  const bulkTemplate = CRM_EMAIL_CATALOG.find(template => template.key === bulkTemplateKey) ?? DEFAULT_CRM_TEMPLATE

  function chooseBulkTemplate(templateKey: string) {
    const template = CRM_EMAIL_CATALOG.find(item => item.key === templateKey)
    if (!template) return
    setBulkTemplateKey(template.key)
    setBulkSubject(template.defaultSubject)
    setBulkMessage(template.defaultMessage ?? '')
  }

  function resetBulkTemplate() {
    setBulkTemplateKey(DEFAULT_CRM_TEMPLATE.key)
    setBulkSubject(DEFAULT_CRM_TEMPLATE.defaultSubject)
    setBulkMessage(DEFAULT_CRM_TEMPLATE.defaultMessage ?? '')
    setBulkAttachment(null)
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
          template_key: bulkTemplateKey,
          subject: bulkSubject,
          message: bulkMessage,
          ...(bulkAttachment ? { attachment_path: bulkAttachment.path, attachment_name: bulkAttachment.name } : {}),
        }),
      })

      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? 'No se pudieron enviar los emails')

      toast.success(`Envío en marcha: ${j.total} leads. Te llega un email cuando termine.`)
      setShowBulkSendModal(false)
      resetBulkTemplate()
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

  // Encabezado ordenable: clic alterna ascendente / descendente (el orden se aplica en el servidor y se recuerda).
  function th(label: string, col: string) {
    const active = sort.key === col
    return (
      <th key={col} className="px-4 py-3 font-semibold" aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button
          type="button"
          onClick={() => { setPage(1); setSort(active ? { key: col, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key: col, dir: 'asc' }) }}
          className={cn('inline-flex items-center gap-1 hover:text-gray-700', active && 'text-violet-700')}
        >
          {label}
          <span className="text-[10px]">{active ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span>
        </button>
      </th>
    )
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
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        // Si falla la creación de la marca al convertir, el backend igual
        // guarda el estado y devuelve el motivo puntual — se muestra ese
        // mensaje en vez de revertir la fila como si nada hubiera pasado.
        toast.error(j.error ?? 'No se pudo actualizar la calificación')
        if (!j.data) load()
        return
      }
      if (j.brand_created) toast.success('Marca creada en SCENCE (pendiente de aprobación) ✓')
    } catch {
      toast.error('No se pudo actualizar la calificación')
      load()
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / limit))
  const extraFilters: Array<{ key: string; label: string; options: Array<[string, string]> }> = [
    { key: 'type', label: 'Tipo', options: [['influencer', 'Influencer'], ['brand', 'Marca'], ['customer', 'Cliente'], ['other', 'Otro']] },
    { key: 'subscription', label: 'Suscripción', options: [['subscribed', 'Suscrito'], ['unsubscribed', 'Desuscrito'], ['unconfirmed', 'Consentimiento no confirmado'], ['blocked', 'Rebotado / spam']] },
    { key: 'activity', label: 'Última interacción', options: [['30', 'Últimos 30 días'], ['90', 'Últimos 90 días']] },
    { key: 'campaign', label: 'Campaña', options: campaigns.map(c => [c.id, c.name] as [string, string]) },
  ]
  const activeFilterCount = [qualification, source, emailStatus, contactData].filter(Boolean).length + (selectedCommunes.length ? 1 : 0) + Object.values(extra).filter(Boolean).length
  const moreCount = [qualification, source, emailStatus, contactData].filter(Boolean).length + Object.entries(extra).filter(([k, v]) => v && k !== 'country' && k !== 'region').length
  const hasActiveFilters = Boolean(search || activeFilterCount - (extra.country === 'Chile' ? 1 : 0))

  function clearFilters() {
    setSearch('')
    setQualification('')
    setSelectedCommunes([])
    setSource('')
    setEmailStatus('')
    setContactData('')
    setExtra({ country: 'Chile' })
    setPage(1)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">CRM — Prospectos</h1>
          <p className="text-sm text-gray-400">
            {total.toLocaleString('es-CL')} empresas cargadas · calificar y contactar ·{' '}
            <Link href="/admin-crm/envios" className="text-violet-600 font-semibold hover:underline">Envíos masivos</Link>
          </p>
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
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative min-w-[240px] flex-[1_1_280px] max-w-md">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <input
              value={search}
              onChange={e => { setPage(1); setSearch(e.target.value) }}
              placeholder="Buscar por empresa, contacto o email..."
              className="h-9 w-full pl-8 pr-3 rounded-lg border border-gray-200 bg-white text-xs outline-none focus:border-violet-400"
            />
          </div>

          <select
            value={extra.country ?? ''}
            aria-label="Filtrar por país"
            onChange={e => chooseCountry(e.target.value)}
            className={cn(
              'h-9 min-w-[130px] rounded-lg border bg-white px-3 text-xs outline-none focus:border-violet-400',
              extra.country ? 'border-violet-300 text-violet-700 font-semibold' : 'border-gray-200 text-gray-700'
            )}
          >
            <option value="">Todos los países</option>
            {geoCountries.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          <select
            value={extra.region ?? ''}
            disabled={!extra.country}
            aria-label="Filtrar por región"
            onChange={e => chooseRegion(e.target.value)}
            className={cn(
              'h-9 min-w-[130px] rounded-lg border bg-white px-3 text-xs outline-none focus:border-violet-400 disabled:opacity-50',
              extra.region ? 'border-violet-300 text-violet-700 font-semibold' : 'border-gray-200 text-gray-700'
            )}
          >
            <option value="">Región / Estado</option>
            {geoRegions.map(r => <option key={r} value={r}>{r}</option>)}
          </select>

          <div className={cn(!extra.region && 'pointer-events-none opacity-50')}>
            <CommuneMultiSelect
              options={geoCommunes}
              selected={selectedCommunes}
              onChange={next => { setPage(1); setSelectedCommunes(next) }}
            />
          </div>

          <button
            type="button"
            aria-expanded={showMore}
            onClick={() => setShowMore(v => !v)}
            className={cn(
              'h-9 rounded-lg border px-3 text-xs font-semibold transition-colors',
              moreCount ? 'border-violet-300 bg-violet-50 text-violet-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
            )}
          >
            Más filtros{moreCount ? ` (${moreCount})` : ''}
          </button>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="h-9 px-2 text-xs font-semibold text-gray-500 hover:text-gray-800"
            >
              Limpiar
            </button>
          )}

          {total > 0 && (
            <button
              type="button"
              onClick={selectAllMatching}
              disabled={selectingAll || allMatchingSelected}
              className="ml-auto h-9 rounded-lg bg-violet-600 px-3 text-xs font-semibold text-white hover:bg-violet-700 disabled:bg-violet-100 disabled:text-violet-700"
            >
              {selectingAll
                ? 'Seleccionando...'
                : allMatchingSelected
                  ? `Todas (${total}) seleccionadas`
                  : `Seleccionar las ${total}`}
            </button>
          )}
        </div>
        {showMore && (
              <div className="flex w-full flex-wrap items-center gap-2 border-t border-gray-50 pt-2">
            <select
              value={source}
              aria-label="Filtrar por base de datos"
              onChange={e => { setPage(1); setSource(e.target.value) }}
              className={cn(
                'h-9 min-w-[170px] rounded-lg border bg-white px-3 text-xs outline-none focus:border-violet-400',
                source ? 'border-violet-300 text-violet-700 font-semibold' : 'border-gray-200 text-gray-700'
              )}
            >
              <option value="">Todas las bases</option>
              {sources.map(value => <option key={value} value={value}>{value}</option>)}
            </select>

            {extraFilters.map(f => (
              <select
                key={f.key}
                value={extra[f.key] ?? ''}
                aria-label={`Filtrar por ${f.label}`}
                onChange={e => { setPage(1); setExtra(prev => ({ ...prev, [f.key]: e.target.value })) }}
                className={cn(
                  'h-9 min-w-[130px] rounded-lg border bg-white px-3 text-xs outline-none focus:border-violet-400',
                  extra[f.key] ? 'border-violet-300 text-violet-700 font-semibold' : 'border-gray-200 text-gray-700'
                )}
              >
                <option value="">{f.label}</option>
                {f.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            ))}

            <select
              value={emailStatus}
              aria-label="Filtrar por estado del email"
              onChange={e => { setPage(1); setEmailStatus(e.target.value) }}
              className={cn(
                'h-9 min-w-[130px] rounded-lg border bg-white px-3 text-xs outline-none focus:border-violet-400',
                emailStatus ? 'border-violet-300 text-violet-700 font-semibold' : 'border-gray-200 text-gray-700'
              )}
            >
              <option value="">Email</option>
              {[['not_sent', 'No enviado'], ['sent', 'Enviado'], ['delivered', 'Entregado'], ['opened', 'Abierto'], ['not_opened', 'No abierto'], ['clicked', 'Clic'], ['bounced', 'Rebotado']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>

            <div className="inline-flex rounded-lg bg-gray-100 p-1" aria-label="Filtrar por interacción de email">
              <button
                type="button"
                aria-pressed={!emailStatus}
                onClick={() => { setPage(1); setEmailStatus('') }}
                className={cn(
                  'h-7 shrink-0 rounded-md px-2.5 text-[11px] font-semibold transition-colors',
                  !emailStatus ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
                )}
              >
                Email: todos
              </button>
              <button
                type="button"
                aria-pressed={emailStatus === 'opened'}
                onClick={() => { setPage(1); setEmailStatus('opened') }}
                className={cn(
                  'h-7 shrink-0 rounded-md px-2.5 text-[11px] font-semibold transition-colors',
                  emailStatus === 'opened' ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-800'
                )}
              >
                Abrió
              </button>
              <button
                type="button"
                aria-pressed={emailStatus === 'clicked'}
                onClick={() => { setPage(1); setEmailStatus('clicked') }}
                className={cn(
                  'h-7 shrink-0 rounded-md px-2.5 text-[11px] font-semibold transition-colors',
                  emailStatus === 'clicked' ? 'bg-white text-violet-700 shadow-sm' : 'text-gray-500 hover:text-gray-800'
                )}
              >
                Hizo clic
              </button>
              <button
                type="button"
                aria-pressed={emailStatus === 'not_sent'}
                onClick={() => { setPage(1); setEmailStatus('not_sent') }}
                className={cn(
                  'h-7 shrink-0 rounded-md px-2.5 text-[11px] font-semibold transition-colors',
                  emailStatus === 'not_sent' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-800'
                )}
              >
                Sin enviar
              </button>
            </div>

            <button
              type="button"
              aria-pressed={qualification === 'interested'}
              onClick={() => { setPage(1); setQualification(qualification === 'interested' ? '' : 'interested') }}
              className={cn(
                'h-9 rounded-lg border px-3 text-xs font-semibold transition-colors',
                qualification === 'interested'
                  ? 'border-amber-200 bg-amber-50 text-amber-700'
                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
              )}
            >
              Interesadas
            </button>

            <div className="inline-flex rounded-lg bg-gray-100 p-1" aria-label="Filtrar por disponibilidad de email">
              {[
                { value: '', label: 'Todos' },
                { value: 'has_email', label: 'Con email' },
                { value: 'missing_email', label: 'Sin email' },
              ].map(option => (
                <button
                  key={option.value || 'all'}
                  type="button"
                  aria-pressed={contactData === option.value}
                  onClick={() => { setPage(1); setContactData(option.value) }}
                  className={cn(
                    'h-7 shrink-0 rounded-md px-2.5 text-[11px] font-semibold transition-colors',
                    contactData === option.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>

              </div>
            )}

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
                  checked={allMatchingSelected}
                  onChange={() => {
                    if (allMatchingSelected) setSelectedIds([])
                    else void selectAllMatching()
                  }}
                  disabled={selectingAll || total === 0}
                  title="Seleccionar todas las empresas filtradas"
                  aria-label="Seleccionar todas las empresas filtradas"
                  className="h-4 w-4 rounded border-gray-300 text-violet-600"
                />
              </th>
              {th('Empresa', 'company_name')}
              {isColumnVisible('contact') && th('Contacto', 'email')}
              {isColumnVisible('rut') && th('RUT', 'contact_rut')}
              {isColumnVisible('type') && <th className="px-4 py-3 font-semibold">Tipo</th>}
              {isColumnVisible('subscription') && <th className="px-4 py-3 font-semibold">Suscripción</th>}
              {isColumnVisible('instagram') && th('Instagram', 'instagram')}
              {isColumnVisible('country') && th('País', 'country')}
              {isColumnVisible('region') && th('Región / Estado', 'region')}
              {isColumnVisible('commune') && th('Comuna / Ciudad', 'commune')}
              {isColumnVisible('industry') && th('Rubro', 'industry')}
              {isColumnVisible('source') && th('Origen', 'source')}
              {isColumnVisible('qualification') && th('Calificación', 'qualification_status')}
              {isColumnVisible('last_email') && th('Último email', 'contacted_at')}
              {isColumnVisible('email_opened') && <th className="px-4 py-3 font-semibold">Abrió email</th>}
              {isColumnVisible('connected') && <th className="px-4 py-3 font-semibold">Conectado</th>}
              {isColumnVisible('action') && <th className="px-4 py-3 font-semibold text-right">Acción</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={visibleColumns.length + 2} className="px-4 py-10 text-center text-gray-400">Cargando…</td></tr>
            ) : leads.length === 0 ? (
              <tr><td colSpan={visibleColumns.length + 2} className="px-4 py-10 text-center text-gray-400">Sin resultados</td></tr>
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
                    <div className="truncate max-w-[180px]">{lead.email || '—'}</div>
                    {lead.contact_name && <div className="text-xs text-gray-400 truncate max-w-[180px]">{lead.contact_name}</div>}
                  </td>
                  )}
{isColumnVisible('rut') && <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{lead.contact_rut || '—'}</td>}
{isColumnVisible('type') && (
                  <td className="px-4 py-3 text-xs">
                    <span className={cn('rounded-full px-2 py-0.5 font-medium', lead.lead_type === 'influencer' ? 'bg-fuchsia-50 text-fuchsia-700' : lead.lead_type === 'customer' ? 'bg-sky-50 text-sky-700' : lead.lead_type === 'brand' ? 'bg-violet-50 text-violet-700' : 'bg-gray-100 text-gray-500')}>
                      {({ influencer: 'Influencer', customer: 'Cliente', brand: 'Marca', other: 'Otro' } as Record<string, string>)[lead.lead_type ?? 'other'] ?? 'Otro'}
                    </span>
                  </td>
                  )}
{isColumnVisible('subscription') && (
                  <td className="px-4 py-3 text-xs">
                    <span className={cn('rounded-full px-2 py-0.5 font-medium', lead.subscription === 'subscribed' ? 'bg-emerald-50 text-emerald-700' : lead.subscription === 'unsubscribed' ? 'bg-red-50 text-red-700' : lead.subscription === 'blocked' ? 'bg-orange-50 text-orange-700' : 'bg-gray-100 text-gray-500')}>
                      {{ subscribed: 'Suscrito', unsubscribed: 'Dado de baja', blocked: 'Rebotado / spam', unconfirmed: 'Sin confirmar', no_email: 'Sin email' }[lead.subscription ?? 'no_email']}
                    </span>
                  </td>
                  )}
{isColumnVisible('instagram') && (
                  <td className="px-4 py-3 text-gray-600 text-xs">
                    {lead.instagram ? (
                      <a
                        href={`https://instagram.com/${lead.instagram.replace(/^@/, '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="text-violet-600 hover:underline truncate max-w-[160px] inline-block"
                      >
                        {lead.instagram}
                      </a>
                    ) : '—'}
                  </td>
                  )}
{isColumnVisible('country') && <td className="px-4 py-3 text-gray-500 text-xs">{lead.country || '—'}</td>}
{isColumnVisible('region') && <td className="px-4 py-3 text-gray-500 text-xs">{lead.region || '—'}</td>}
{isColumnVisible('commune') && <td className="px-4 py-3 text-gray-500 text-xs">{lead.commune || '—'}</td>}
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
                      {statusOptions(lead.qualification_status).map(k => (
                        <option key={k} value={k}>{STATUS_CONFIG[k]?.label ?? k}</option>
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
                <label className="block text-xs font-semibold text-gray-500 mb-1">Tipo de email</label>
                <select
                  value={bulkTemplateKey}
                  onChange={event => chooseBulkTemplate(event.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 bg-white text-sm outline-none focus:border-violet-400"
                >
                  {CRM_EMAIL_CATALOG.map(template => (
                    <option key={template.key} value={template.key}>{template.name}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-400">{bulkTemplate.description}</p>
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
                  Mensaje
                </label>
                <textarea
                  value={bulkMessage}
                  onChange={e => setBulkMessage(e.target.value)}
                  placeholder="Edita el mensaje antes de enviar si quieres personalizarlo."
                  rows={8}
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm outline-none focus:border-violet-400 resize-none"
                />
                <p className="mt-1 text-xs text-gray-400">
                  Puedes editarlo. Las variables {'{{contact_name}}'} y {'{{company_name}}'} se personalizan para cada lead.
                </p>
              </div>

              <AttachmentPicker value={bulkAttachment} onChange={setBulkAttachment} disabled={sendingBulk} />
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
              <input value={form.instagram} onChange={e => updateForm('instagram', e.target.value)} placeholder="@instagram" className="px-3 py-2.5 rounded-xl border border-gray-200 text-sm outline-none focus:border-violet-400" />
              <input value={form.industry} onChange={e => updateForm('industry', e.target.value)} placeholder="Rubro / categoría" className="px-3 py-2.5 rounded-xl border border-gray-200 text-sm outline-none focus:border-violet-400" />
              <input value={form.source} onChange={e => updateForm('source', e.target.value)} list="crm-niche-sources" placeholder="Origen / nicho" className="px-3 py-2.5 rounded-xl border border-gray-200 text-sm outline-none focus:border-violet-400" />
              <datalist id="crm-niche-sources">
                {CRM_NICHE_SOURCES.map(niche => <option key={niche} value={niche} />)}
              </datalist>
              <div className="md:col-span-2">
                <CrmLocationFields
                  value={{ country: form.country, region: form.region, commune: form.commune }}
                  onChange={next => setForm(previous => ({ ...previous, ...next }))}
                />
              </div>
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
