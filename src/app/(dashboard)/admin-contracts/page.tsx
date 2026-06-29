'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  FileText, Plus, X, Eye, Trash2, Copy, CheckCheck,
  ChevronDown, Sparkles, Search, AlertCircle, Loader2,
  FileSignature, RefreshCw,
} from 'lucide-react'
import { toast } from 'sonner'

// ── Types ─────────────────────────────────────────────────────────────────────
type CampaignType =
  | 'sponsored_post'
  | 'event_appearance'
  | 'ambassador'
  | 'product_seeding'
  | 'ugc'
  | 'live'

interface ContractTemplate {
  id: string
  name: string
  campaign_type: CampaignType | null
  content: string
  variables: string[]
  created_at: string
  updated_at?: string
}

// ── Constants ─────────────────────────────────────────────────────────────────
const CAMPAIGN_TYPE_LABELS: Record<CampaignType, string> = {
  sponsored_post:   'Post Patrocinado',
  event_appearance: 'Aparición en Evento',
  ambassador:       'Embajador',
  product_seeding:  'Product Seeding',
  ugc:              'UGC',
  live:             'Live / Stream',
}

const CAMPAIGN_TYPE_BADGE: Record<CampaignType, string> = {
  sponsored_post:   'badge badge-blue',
  event_appearance: 'badge badge-orange',
  ambassador:       'badge badge-purple',
  product_seeding:  'badge badge-green',
  ugc:              'badge badge-gray',
  live:             'badge badge-red',
}

const HINT_VARIABLES = [
  '{{influencer_name}}',
  '{{campaign_name}}',
  '{{fee}}',
  '{{start_date}}',
  '{{end_date}}',
  '{{deliverables}}',
  '{{platform}}',
  '{{brand_name}}',
  '{{payment_terms}}',
]

const SAMPLE_VALUES: Record<string, string> = {
  '{{influencer_name}}': 'Valentina Reyes',
  '{{campaign_name}}':   'Campaña Verano 2025',
  '{{fee}}':             '$2,500 USD',
  '{{start_date}}':      '1 de junio de 2025',
  '{{end_date}}':        '30 de junio de 2025',
  '{{deliverables}}':    '3 posts en Instagram + 2 Stories',
  '{{platform}}':        'Instagram',
  '{{brand_name}}':      'SCENCE Agency',
  '{{payment_terms}}':   '50% al inicio, 50% al publicar',
}

const DEFAULT_CONTENT = `CONTRATO DE COLABORACIÓN

Entre {{brand_name}} (en adelante "La Marca") y {{influencer_name}} (en adelante "El Influencer"), se acuerda lo siguiente:

1. CAMPAÑA
El Influencer participará en la campaña "{{campaign_name}}" a través de {{platform}}.

2. ENTREGABLES
El Influencer se compromete a producir y publicar: {{deliverables}}.

3. VIGENCIA
El presente contrato tiene vigencia desde el {{start_date}} hasta el {{end_date}}.

4. COMPENSACIÓN
La Marca pagará al Influencer la suma de {{fee}} según los siguientes términos: {{payment_terms}}.

5. DERECHOS DE USO
El Influencer otorga a La Marca una licencia no exclusiva para reutilizar el contenido creado durante un período de 12 meses.

6. CONFIDENCIALIDAD
Ambas partes se comprometen a mantener la confidencialidad de los términos de este acuerdo.

Firmado digitalmente en acuerdo mutuo.`

// ── Utilities ─────────────────────────────────────────────────────────────────
function renderPreview(content: string, values: Record<string, string> = SAMPLE_VALUES): string {
  let result = content
  for (const [variable, value] of Object.entries(values)) {
    result = result.replaceAll(variable, value)
  }
  return result
}

function extractVariables(content: string): string[] {
  const matches = content.match(/\{\{[a-z_]+\}\}/g) ?? []
  return Array.from(new Set(matches))
}

// ── Empty State ───────────────────────────────────────────────────────────────
function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="card p-14 text-center max-w-md mx-auto mt-8">
      <div className="w-20 h-20 rounded-2xl bg-violet-50 flex items-center justify-center mx-auto mb-5">
        <FileSignature className="h-9 w-9 text-violet-400" />
      </div>
      <h2 className="text-lg font-bold text-gray-900 mb-2">Sin plantillas todavía</h2>
      <p className="text-sm text-gray-500 mb-6 leading-relaxed">
        Crea plantillas de contrato reutilizables con variables dinámicas para cada
        tipo de colaboración. Ahorra tiempo en cada campaña.
      </p>
      <button
        onClick={onNew}
        className="inline-flex items-center gap-2 bg-violet-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-violet-700 transition-colors"
      >
        <Plus className="h-4 w-4" />
        Crear primera plantilla
      </button>
    </div>
  )
}

// ── Create / Edit Modal ───────────────────────────────────────────────────────
function TemplateModal({
  template,
  onClose,
  onSaved,
}: {
  template?: ContractTemplate
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = !!template
  const [name, setName] = useState(template?.name ?? '')
  const [campaignType, setCampaignType] = useState<CampaignType | ''>(template?.campaign_type ?? '')
  const [content, setContent] = useState(template?.content ?? DEFAULT_CONTENT)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const detectedVars = extractVariables(content)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!name.trim() || !content.trim()) {
      setError('El nombre y el contenido son obligatorios')
      return
    }
    setSaving(true)
    try {
      const url = isEdit
        ? `/api/contracts/templates/${template!.id}`
        : '/api/contracts/templates'
      const method = isEdit ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          campaign_type: campaignType || null,
          content: content.trim(),
          variables: detectedVars,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Error al guardar')
      toast.success(isEdit ? 'Plantilla actualizada' : 'Plantilla creada')
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setSaving(false)
    }
  }

  const insertVar = (v: string) => {
    setContent(prev => prev + v)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-10 bg-black/40 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mb-10"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">
            {isEdit ? 'Editar plantilla' : 'Nueva plantilla de contrato'}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-5">
          {/* Name + Type */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                Nombre de la plantilla *
              </label>
              <input
                className="input-base"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Contrato Ambassador, Contrato UGC…"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                Tipo de campaña
              </label>
              <select
                className="input-base"
                value={campaignType}
                onChange={e => setCampaignType(e.target.value as CampaignType | '')}
              >
                <option value="">— Sin tipo —</option>
                {Object.entries(CAMPAIGN_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Variable hints */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-2">
              Variables disponibles — click para insertar
            </label>
            <div className="flex flex-wrap gap-1.5">
              {HINT_VARIABLES.map(v => (
                <button
                  key={v}
                  type="button"
                  onClick={() => insertVar(v)}
                  className="text-xs bg-violet-50 text-violet-700 border border-violet-200 rounded-md px-2 py-0.5 font-mono hover:bg-violet-100 transition-colors"
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* Content */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">
              Contenido del contrato *
            </label>
            <textarea
              className="input-base resize-none font-mono text-xs leading-relaxed"
              rows={16}
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="Redacta el contrato usando variables como {{influencer_name}}…"
              required
            />
          </div>

          {/* Detected variables */}
          {detectedVars.length > 0 && (
            <div className="bg-violet-50 rounded-lg p-3">
              <p className="text-xs font-semibold text-violet-700 mb-1.5">
                Variables detectadas en el contrato:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {detectedVars.map(v => (
                  <span
                    key={v}
                    className="text-xs bg-white text-violet-600 border border-violet-200 rounded px-1.5 py-0.5 font-mono"
                  >
                    {v}
                  </span>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 bg-violet-600 text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-violet-700 disabled:opacity-60 transition-colors"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear plantilla'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Preview Modal ─────────────────────────────────────────────────────────────
function PreviewModal({
  template,
  onClose,
}: {
  template: ContractTemplate
  onClose: () => void
}) {
  const preview = renderPreview(template.content)
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(preview)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-10 bg-black/40 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mb-10"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div>
            <h2 className="text-base font-bold text-gray-900">{template.name}</h2>
            <p className="text-xs text-gray-400 mt-0.5">Vista previa con datos de ejemplo</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-violet-600 hover:text-violet-700 bg-violet-50 hover:bg-violet-100 px-3 py-1.5 rounded-lg transition-colors"
            >
              {copied ? <CheckCheck className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copiado' : 'Copiar'}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="p-6">
          <pre className="whitespace-pre-wrap text-sm text-gray-700 leading-relaxed font-sans bg-gray-50 rounded-xl p-5 border border-gray-100 max-h-[60vh] overflow-y-auto">
            {preview}
          </pre>
        </div>
      </div>
    </div>
  )
}

// ── Generate Contract Modal ───────────────────────────────────────────────────
function GenerateModal({
  template,
  onClose,
}: {
  template: ContractTemplate
  onClose: () => void
}) {
  const variables = extractVariables(template.content)
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const v of variables) {
      init[v] = SAMPLE_VALUES[v] ?? ''
    }
    return init
  })
  const [generated, setGenerated] = useState(false)
  const [copied, setCopied] = useState(false)

  const filledContent = renderPreview(template.content, values)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(filledContent)
    setCopied(true)
    toast.success('Contrato copiado al portapapeles')
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-10 bg-black/40 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mb-10"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div>
            <h2 className="text-base font-bold text-gray-900">Generar contrato</h2>
            <p className="text-xs text-gray-400 mt-0.5">Basado en: {template.name}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5">
          {!generated ? (
            <div className="space-y-4">
              <p className="text-sm text-gray-500">
                Completa los valores para las variables de esta plantilla:
              </p>
              {variables.length === 0 ? (
                <div className="text-sm text-gray-400 bg-gray-50 rounded-lg p-4 text-center">
                  Esta plantilla no tiene variables definidas.
                </div>
              ) : (
                <div className="space-y-3">
                  {variables.map(v => {
                    const label = v.replace(/\{\{|\}\}/g, '').replace(/_/g, ' ')
                    return (
                      <div key={v}>
                        <label className="block text-xs font-semibold text-gray-600 mb-1 capitalize">
                          {label}
                          <span className="ml-1.5 font-mono text-violet-500 font-normal">{v}</span>
                        </label>
                        <input
                          className="input-base"
                          value={values[v] ?? ''}
                          onChange={e => setValues(prev => ({ ...prev, [v]: e.target.value }))}
                          placeholder={SAMPLE_VALUES[v] ?? `Valor para ${label}`}
                        />
                      </div>
                    )
                  })}
                </div>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => setGenerated(true)}
                  className="inline-flex items-center gap-2 bg-violet-600 text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-violet-700 transition-colors"
                >
                  <Sparkles className="h-4 w-4" />
                  Generar contrato
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-700">Contrato generado</p>
                <button
                  onClick={() => setGenerated(false)}
                  className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors"
                >
                  <RefreshCw className="h-3 w-3" />
                  Editar valores
                </button>
              </div>
              <pre className="whitespace-pre-wrap text-sm text-gray-700 leading-relaxed font-sans bg-gray-50 rounded-xl p-5 border border-gray-100 max-h-[50vh] overflow-y-auto">
                {filledContent}
              </pre>
              <div className="flex justify-end">
                <button
                  onClick={handleCopy}
                  className="inline-flex items-center gap-2 bg-violet-600 text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-violet-700 transition-colors"
                >
                  {copied ? <CheckCheck className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? 'Copiado' : 'Copiar contrato'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Delete Confirm Modal ──────────────────────────────────────────────────────
function DeleteModal({
  template,
  onClose,
  onDeleted,
}: {
  template: ContractTemplate
  onClose: () => void
  onDeleted: () => void
}) {
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    setDeleting(true)
    try {
      const res = await fetch(`/api/contracts/templates/${template.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const json = await res.json()
        throw new Error(json.error ?? 'Error al eliminar')
      }
      toast.success('Plantilla eliminada')
      onDeleted()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al eliminar')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
          <Trash2 className="h-5 w-5 text-red-500" />
        </div>
        <h3 className="text-base font-bold text-gray-900 text-center mb-1">Eliminar plantilla</h3>
        <p className="text-sm text-gray-500 text-center mb-6">
          ¿Eliminar <span className="font-semibold text-gray-700">{template.name}</span>? Esta acción no se puede deshacer.
        </p>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="flex-1 inline-flex items-center justify-center gap-2 bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-red-700 disabled:opacity-60 transition-colors"
          >
            {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
            {deleting ? 'Eliminando…' : 'Eliminar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Template Card ─────────────────────────────────────────────────────────────
function TemplateCard({
  template,
  onPreview,
  onEdit,
  onGenerate,
  onDelete,
}: {
  template: ContractTemplate
  onPreview: () => void
  onEdit: () => void
  onGenerate: () => void
  onDelete: () => void
}) {
  const variables = extractVariables(template.content)
  const preview = template.content.slice(0, 120).replace(/\n/g, ' ')

  return (
    <div className="card p-5 flex flex-col gap-4 hover:border-violet-200 hover:shadow-md transition-all">
      {/* Top row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <FileText className="h-4 w-4 text-violet-400 flex-shrink-0" />
            <h3 className="text-sm font-bold text-gray-900 truncate">{template.name}</h3>
          </div>
          {template.campaign_type && (
            <span className={CAMPAIGN_TYPE_BADGE[template.campaign_type]}>
              {CAMPAIGN_TYPE_LABELS[template.campaign_type]}
            </span>
          )}
        </div>
      </div>

      {/* Content preview */}
      <p className="text-xs text-gray-400 leading-relaxed line-clamp-2">
        {preview}{template.content.length > 120 ? '…' : ''}
      </p>

      {/* Variables */}
      {variables.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {variables.slice(0, 5).map(v => (
            <span
              key={v}
              className="text-xs bg-violet-50 text-violet-600 border border-violet-100 rounded px-1.5 py-0.5 font-mono"
            >
              {v}
            </span>
          ))}
          {variables.length > 5 && (
            <span className="text-xs text-gray-400">+{variables.length - 5} más</span>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1 border-t border-gray-100">
        <button
          onClick={onPreview}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 px-2.5 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <Eye className="h-3.5 w-3.5" />
          Vista previa
        </button>
        <button
          onClick={onEdit}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 px-2.5 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Editar
        </button>
        <button
          onClick={onGenerate}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-violet-600 hover:text-violet-700 px-2.5 py-1.5 rounded-lg hover:bg-violet-50 transition-colors ml-auto"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Generar contrato
        </button>
        <button
          onClick={onDelete}
          className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
          title="Eliminar plantilla"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ContractsPage() {
  const [templates, setTemplates] = useState<ContractTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState<CampaignType | ''>('')

  // Modals
  const [showCreate, setShowCreate] = useState(false)
  const [editTarget, setEditTarget] = useState<ContractTemplate | null>(null)
  const [previewTarget, setPreviewTarget] = useState<ContractTemplate | null>(null)
  const [generateTarget, setGenerateTarget] = useState<ContractTemplate | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ContractTemplate | null>(null)
  const [dbError, setDbError] = useState<string | null>(null)

  const loadTemplates = useCallback(async () => {
    setLoading(true)
    setDbError(null)
    try {
      const res = await fetch('/api/contracts/templates')
      const json = await res.json()
      if (!res.ok) {
        // Surface DB-level errors (e.g. missing table) clearly
        const msg: string = json.error ?? 'Error desconocido'
        if (msg.includes('does not exist') || msg.includes('schema cache')) {
          setDbError('La tabla de contratos no existe. Ejecuta MIGRATIONS.sql en Supabase → SQL Editor.')
        } else {
          setDbError(msg)
        }
        return
      }
      setTemplates(json.data ?? [])
    } catch {
      setDbError('No se pudo conectar con el servidor.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadTemplates()
  }, [loadTemplates])

  // Filtered list
  const filtered = templates.filter(t => {
    const matchSearch =
      !search ||
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.content.toLowerCase().includes(search.toLowerCase())
    const matchType = !filterType || t.campaign_type === filterType
    return matchSearch && matchType
  })

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Contratos</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Plantillas de contrato reutilizables con variables dinámicas
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 bg-violet-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-violet-700 transition-colors shadow-sm"
        >
          <Plus className="h-4 w-4" />
          Nueva plantilla
        </button>
      </div>

      {/* Stats bar */}
      {templates.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="card px-4 py-3">
            <p className="text-xs text-gray-500 mb-0.5">Total plantillas</p>
            <p className="text-xl font-bold text-gray-900">{templates.length}</p>
          </div>
          {(Object.entries(CAMPAIGN_TYPE_LABELS) as [CampaignType, string][])
            .filter(([type]) => templates.some(t => t.campaign_type === type))
            .slice(0, 3)
            .map(([type, label]) => (
              <div key={type} className="card px-4 py-3">
                <p className="text-xs text-gray-500 mb-0.5 truncate">{label}</p>
                <p className="text-xl font-bold text-gray-900">
                  {templates.filter(t => t.campaign_type === type).length}
                </p>
              </div>
            ))}
        </div>
      )}

      {/* Filters */}
      {templates.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              className="input-base pl-9"
              placeholder="Buscar plantillas…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="relative">
            <select
              className="input-base pr-8 appearance-none"
              value={filterType}
              onChange={e => setFilterType(e.target.value as CampaignType | '')}
            >
              <option value="">Todos los tipos</option>
              {Object.entries(CAMPAIGN_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
          </div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 text-violet-500 animate-spin" />
        </div>
      ) : dbError ? (
        <div className="card p-8 flex items-start gap-4 border-red-100 bg-red-50">
          <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-700 mb-1">Error de base de datos</p>
            <p className="text-sm text-red-600">{dbError}</p>
            <button onClick={loadTemplates} className="mt-3 text-sm font-medium text-red-700 underline hover:no-underline">
              Reintentar
            </button>
          </div>
        </div>
      ) : templates.length === 0 ? (
        <EmptyState onNew={() => setShowCreate(true)} />
      ) : filtered.length === 0 ? (
        <div className="card p-10 text-center text-sm text-gray-400">
          No se encontraron plantillas con los filtros actuales.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(t => (
            <TemplateCard
              key={t.id}
              template={t}
              onPreview={() => setPreviewTarget(t)}
              onEdit={() => setEditTarget(t)}
              onGenerate={() => setGenerateTarget(t)}
              onDelete={() => setDeleteTarget(t)}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      {showCreate && (
        <TemplateModal
          onClose={() => setShowCreate(false)}
          onSaved={loadTemplates}
        />
      )}
      {editTarget && (
        <TemplateModal
          template={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={loadTemplates}
        />
      )}
      {previewTarget && (
        <PreviewModal
          template={previewTarget}
          onClose={() => setPreviewTarget(null)}
        />
      )}
      {generateTarget && (
        <GenerateModal
          template={generateTarget}
          onClose={() => setGenerateTarget(null)}
        />
      )}
      {deleteTarget && (
        <DeleteModal
          template={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={loadTemplates}
        />
      )}
    </div>
  )
}
