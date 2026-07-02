'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Plus, X, Building2, Calendar, RefreshCw,
  FileText, ChevronRight, Loader2, Sparkles,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

// ── Types ─────────────────────────────────────────────────────────────────────
type Campaign = {
  id: string
  name: string
  brand_name: string | null
  brand_logo: string | null
  start_date: string | null
  end_date: string | null
  status: string
  deliverables_total: number
  deliverables_done: number
  self_created: boolean
}

type OpenCampaign = {
  id: string
  name: string
  status: string
  description: string | null
  start_date: string | null
  end_date: string | null
  brand: { id: string; name: string; logo_url: string | null } | null
  _applied?: boolean
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  active:    { label: 'Activa',     color: 'bg-green-100 text-green-700' },
  draft:     { label: 'Borrador',   color: 'bg-gray-100 text-gray-500' },
  completed: { label: 'Completada', color: 'bg-violet-100 text-violet-700' },
  canceled:  { label: 'Cancelada',  color: 'bg-red-100 text-red-500' },
  paused:    { label: 'Pausada',    color: 'bg-amber-100 text-amber-700' },
}

function fmt(iso: string | null) {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' })
}

type ApiRow = {
  id: string | null
  status: string
  _self_created?: boolean
  campaign: {
    id: string
    name: string
    status: string
    start_date: string | null
    end_date: string | null
    brand?: { id: string; name: string; logo_url: string | null } | null
  } | null
  campaign_deliverables: Array<{ id: string; status: string }>
}

function toRow(row: ApiRow): Campaign | null {
  const c = row.campaign
  if (!c?.id) return null
  const total = row.campaign_deliverables?.length ?? 0
  const done  = (row.campaign_deliverables ?? []).filter(d => d.status === 'approved' || d.status === 'published').length
  return {
    id:                 c.id,
    name:               c.name,
    brand_name:         c.brand?.name ?? null,
    brand_logo:         c.brand?.logo_url ?? null,
    start_date:         c.start_date,
    end_date:           c.end_date,
    status:             c.status ?? row.status,
    deliverables_total: total,
    deliverables_done:  done,
    self_created:       row._self_created ?? false,
  }
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function MyCampaignsPage() {
  const router = useRouter()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading,   setLoading]   = useState(true)
  const [showForm,  setShowForm]  = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [form, setForm] = useState({
    name: '', brand_name: '', start_date: '', end_date: '', description: '',
  })
  const [openCampaigns, setOpenCampaigns] = useState<OpenCampaign[]>([])
  const [applying,      setApplying]      = useState<string | null>(null)
  const [brandFilter,   setBrandFilter]   = useState<string>('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [res, openRes] = await Promise.all([
        fetch('/api/influencer/my-campaigns'),
        fetch('/api/influencer/campaigns/open'),
      ])
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      const rows = (json.data ?? []).map(toRow).filter(Boolean) as Campaign[]
      setCampaigns(rows)
      setOpenCampaigns(openRes.ok ? (await openRes.json()).data ?? [] : [])
    } catch { toast.error('Error cargando campañas') }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function handleApply(campaignId: string, campaignName: string) {
    if (!confirm(`¿Enviar solicitud para unirte a "${campaignName}"? El equipo la revisará y te confirmará.`)) return
    setApplying(campaignId)
    try {
      const res = await fetch(`/api/influencer/campaigns/${campaignId}/apply`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('¡Solicitud enviada! El equipo te confirmará pronto.')
      setOpenCampaigns(prev => prev.map(c => c.id === campaignId ? { ...c, _applied: true } : c))
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error al enviar solicitud')
    }
    setApplying(null)
  }

  async function create() {
    if (!form.name.trim()) { toast.error('El nombre es requerido'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/influencer/my-campaigns', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:        form.name.trim(),
          start_date:  form.start_date || null,
          end_date:    form.end_date   || null,
          description: form.description || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Campaña creada')
      setShowForm(false)
      setForm({ name: '', brand_name: '', start_date: '', end_date: '', description: '' })
      // Navigate straight to the new campaign detail
      const newId = json.data?.campaign?.id
      if (newId) router.push(`/inf-campaign/${newId}`)
      else load()
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Error') }
    setSaving(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-10 h-10 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
      </div>
    )
  }

  const assigned    = campaigns.filter(c => !c.self_created)
  const selfCreated = campaigns.filter(c => c.self_created)

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Campañas</h1>
          <p className="text-sm text-gray-400 mt-0.5">Tus campañas propias y las asignadas por tu agencia</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400">
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            onClick={() => setShowForm(v => !v)}
            className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700 transition-colors"
          >
            {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {showForm ? 'Cancelar' : 'Nueva campaña'}
          </button>
        </div>
      </div>

      {/* New campaign form */}
      {showForm && (
        <div className="bg-white rounded-2xl border border-violet-100 p-6 space-y-4">
          <h2 className="text-sm font-bold text-gray-700">Nueva campaña</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-gray-500 mb-1">Nombre *</label>
              <input
                type="text"
                placeholder="Ej: Campaña Verano 2026"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-violet-400 bg-gray-50 focus:bg-white transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Fecha inicio</label>
              <input
                type="date"
                value={form.start_date}
                onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-violet-400 bg-gray-50 focus:bg-white transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Fecha fin</label>
              <input
                type="date"
                value={form.end_date}
                onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-violet-400 bg-gray-50 focus:bg-white transition-colors"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-gray-500 mb-1">Descripción / brief</label>
              <textarea
                rows={3}
                placeholder="Objetivos, lineamientos, notas de la campaña…"
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-violet-400 bg-gray-50 focus:bg-white transition-colors resize-none"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={create}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700 disabled:opacity-60 transition-colors"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {saving ? 'Creando…' : 'Crear campaña'}
            </button>
          </div>
        </div>
      )}

      {/* Campañas disponibles para postular */}
      {openCampaigns.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-violet-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5" /> Disponibles para postular ({openCampaigns.length})
          </p>

          {(() => {
            const brands = openCampaigns.map(c => c.brand?.name).filter((b): b is string => !!b)
            const unique = brands.filter((b, i) => brands.indexOf(b) === i)
            return unique.length > 1 ? (
              <div className="flex gap-2 flex-wrap pb-3">
                <button onClick={() => setBrandFilter('')}
                  className={cn('text-xs font-semibold px-3 py-1 rounded-full border transition-colors',
                    brandFilter === '' ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-gray-500 border-gray-200 hover:border-violet-300')}>
                  Todas
                </button>
                {unique.map(brand => (
                  <button key={brand} onClick={() => setBrandFilter(brand === brandFilter ? '' : brand)}
                    className={cn('text-xs font-semibold px-3 py-1 rounded-full border transition-colors',
                      brandFilter === brand ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-gray-500 border-gray-200 hover:border-violet-300')}>
                    {brand}
                  </button>
                ))}
              </div>
            ) : null
          })()}

          <div className="space-y-3">
            {openCampaigns
              .filter(c => !brandFilter || c.brand?.name === brandFilter)
              .map(c => (
              <div key={c.id} className={cn(
                'rounded-xl p-4 border',
                c._applied ? 'bg-amber-50/50 border-amber-100' : 'bg-white border-gray-100'
              )}>
                <div className="flex items-start gap-3">
                  {c.brand?.logo_url ? (
                    <img src={c.brand.logo_url} alt={c.brand.name} className="w-9 h-9 rounded-lg object-contain bg-white border border-gray-100 flex-shrink-0" />
                  ) : (
                    <div className="w-9 h-9 rounded-lg bg-violet-100 flex items-center justify-center flex-shrink-0 text-xs font-bold text-violet-600">
                      {c.brand?.name?.charAt(0) ?? '?'}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-900 truncate">{c.name}</span>
                      {c._applied ? (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">En revisión</span>
                      ) : (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">Abierta</span>
                      )}
                    </div>
                    {c.brand && <p className="text-xs font-medium text-violet-600 mt-0.5">{c.brand.name}</p>}
                    {c.description && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{c.description}</p>}
                    {c._applied && (
                      <p className="text-[10px] text-amber-600 mt-1">Ya postulaste — el equipo te confirmará pronto.</p>
                    )}
                    {(c.start_date || c.end_date) && (
                      <p className="text-[10px] text-gray-400 mt-1">
                        {c.start_date ? new Date(c.start_date).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' }) : '—'}
                        {' → '}
                        {c.end_date ? new Date(c.end_date).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                      </p>
                    )}
                  </div>
                  <div className="flex-shrink-0 flex flex-col items-end gap-1.5">
                    <Link href={`/inf-campaign/${c.id}`} className="text-[10px] font-semibold text-gray-400 hover:text-violet-600 transition-colors">
                      Ver detalles
                    </Link>
                    {c._applied ? (
                      <span className="text-[10px] font-bold text-amber-600">⏳ En revisión</span>
                    ) : (
                      <button
                        onClick={() => handleApply(c.id, c.name)}
                        disabled={applying === c.id}
                        className="text-xs font-bold bg-violet-600 text-white px-3 py-1.5 rounded-lg hover:bg-violet-700 disabled:opacity-50 transition-colors"
                      >
                        {applying === c.id ? '…' : 'Aplicar'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {campaigns.length === 0 && !showForm && (
        <div className="bg-white rounded-2xl border border-gray-100 flex flex-col items-center py-20 gap-3">
          <FileText className="h-10 w-10 text-gray-200" />
          <p className="text-sm font-semibold text-gray-400">Sin campañas aún</p>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 text-sm font-semibold bg-violet-600 text-white px-4 py-2 rounded-xl hover:bg-violet-700"
          >
            <Plus className="h-4 w-4" /> Crear mi primera campaña
          </button>
        </div>
      )}

      {/* Assigned campaigns */}
      {assigned.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Asignadas por agencia ({assigned.length})
          </p>
          <div className="space-y-2">
            {assigned.map(c => <CampaignRow key={c.id} campaign={c} />)}
          </div>
        </div>
      )}

      {/* Self-created campaigns */}
      {selfCreated.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Mis campañas ({selfCreated.length})
          </p>
          <div className="space-y-2">
            {selfCreated.map(c => <CampaignRow key={c.id} campaign={c} />)}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Campaign card ─────────────────────────────────────────────────────────────
function CampaignRow({ campaign: c }: { campaign: Campaign }) {
  const router  = useRouter()
  const stCfg   = STATUS_CONFIG[c.status] ?? STATUS_CONFIG.active
  const pct     = c.deliverables_total > 0 ? Math.round((c.deliverables_done / c.deliverables_total) * 100) : 0

  return (
    <button
      onClick={() => router.push(`/inf-campaign/${c.id}`)}
      className="w-full bg-white rounded-2xl border border-gray-100 p-4 hover:border-violet-200 hover:shadow-sm transition-all text-left"
    >
      <div className="flex items-center gap-3">

        {/* Brand logo */}
        <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center flex-shrink-0 overflow-hidden">
          {c.brand_logo
            ? <img src={c.brand_logo} alt={c.brand_name ?? ''} className="w-10 h-10 object-contain" />
            : <Building2 className="h-5 w-5 text-violet-300" />}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-gray-900 truncate">{c.name}</p>
            <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0', stCfg.color)}>
              {stCfg.label}
            </span>
          </div>

          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            {c.brand_name && (
              <span className="text-xs text-violet-600 font-medium">{c.brand_name}</span>
            )}
            {c.start_date && (
              <span className="text-xs text-gray-400 flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {fmt(c.start_date)}{c.end_date ? ` → ${fmt(c.end_date)}` : ''}
              </span>
            )}
          </div>

          {c.deliverables_total > 0 && (
            <div className="mt-2 flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden max-w-[100px]">
                <div
                  className={cn('h-full rounded-full transition-all', pct === 100 ? 'bg-green-500' : 'bg-violet-500')}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-[10px] text-gray-400">{c.deliverables_done}/{c.deliverables_total}</span>
            </div>
          )}
        </div>

        <ChevronRight className="h-4 w-4 text-gray-300 flex-shrink-0" />
      </div>
    </button>
  )
}
