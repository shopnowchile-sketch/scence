'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import Link from 'next/link'
import {
  Building2, Plus, X, Globe, Mail, Phone, Target,
  Pencil, Trash2, ExternalLink, Search, Loader2, Send,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Brand {
  id: string
  name: string
  logo_url: string | null
  website: string | null
  industry: string | null
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  notes: string | null
  created_at: string
  status?: string | null
  last_sign_in_at?: string | null
  user_id?: string | null
  campaigns?: Array<{ id: string; name: string; status: string; budget_total: number | null; currency: string }>
}

type FormData = {
  name: string; logo_url: string; website: string; industry: string
  contact_name: string; contact_email: string; contact_phone: string; notes: string
}

const INDUSTRIES = [
  'Moda & Belleza', 'Tecnología', 'Alimentación & Bebidas', 'Deportes & Fitness',
  'Viajes & Turismo', 'Entretenimiento', 'Salud & Bienestar', 'Automotriz',
  'Finanzas', 'Educación', 'Hogar & Deco', 'Otro',
]

const EMPTY_FORM: FormData = {
  name: '', logo_url: '', website: '', industry: '',
  contact_name: '', contact_email: '', contact_phone: '', notes: '',
}

// ── BrandModal — module-level so it never remounts on parent re-render ─────────

function BrandModal({
  editing,
  onClose,
  onSaved,
}: {
  editing: Brand | null
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState<FormData>(() =>
    editing
      ? {
          name: editing.name,
          logo_url: editing.logo_url ?? '',
          website: editing.website ?? '',
          industry: editing.industry ?? '',
          contact_name: editing.contact_name ?? '',
          contact_email: editing.contact_email ?? '',
          contact_phone: editing.contact_phone ?? '',
          notes: editing.notes ?? '',
        }
      : EMPTY_FORM
  )
  const [saving, setSaving] = useState(false)

  const set = (k: keyof FormData, v: string) => setForm(f => ({ ...f, [k]: v }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    try {
      const url    = editing ? `/api/brands/${editing.id}` : '/api/brands'
      const method = editing ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          logo_url:      form.logo_url || null,
          website:       form.website || null,
          industry:      form.industry || null,
          contact_name:  form.contact_name || null,
          contact_email: form.contact_email || null,
          contact_phone: form.contact_phone || null,
          notes:         form.notes || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Error al guardar')
      toast.success(editing ? 'Marca actualizada' : 'Marca creada ✓')
      onSaved()
      onClose()
    } catch (err: unknown) {
      toast.error((err as Error).message ?? 'Error desconocido')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">{editing ? 'Editar marca' : 'Nueva marca'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Nombre *</label>
            <input
              className="input-base w-full"
              value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder="Nike, Coca-Cola..."
              required
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Industria</label>
              <select className="input-base w-full" value={form.industry} onChange={e => set('industry', e.target.value)}>
                <option value="">— Selecciona —</option>
                {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Website</label>
              <input className="input-base w-full" value={form.website} onChange={e => set('website', e.target.value)} placeholder="https://..." />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Logo URL</label>
            <input className="input-base w-full" value={form.logo_url} onChange={e => set('logo_url', e.target.value)} placeholder="https://..." />
          </div>
          <div className="border-t border-gray-100 pt-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Contacto</p>
            <div className="space-y-3">
              <input className="input-base w-full" value={form.contact_name} onChange={e => set('contact_name', e.target.value)} placeholder="Nombre del contacto" />
              <input type="email" className="input-base w-full" value={form.contact_email} onChange={e => set('contact_email', e.target.value)} placeholder="email@marca.com" />
              <input className="input-base w-full" value={form.contact_phone} onChange={e => set('contact_phone', e.target.value)} placeholder="+52 55 1234 5678" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Notas internas</label>
            <textarea
              className="input-base w-full resize-none"
              rows={2}
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              placeholder="Condiciones especiales, contexto..."
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 text-sm font-semibold rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2 text-sm font-semibold rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-60 transition-colors flex items-center justify-center gap-2"
            >
              {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Guardando...</> : (editing ? 'Guardar cambios' : 'Crear marca')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function initials(name: string) {
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

// ── Main page ──────────────────────────────────────────────────────────────────

interface BrandInfluencer {
  id: string
  display_name: string
  avatar_url: string | null
  status: string
  campaign_name: string
}

export default function BrandsPage() {
  const [brands, setBrands]           = useState<Brand[]>([])
  const [loading, setLoading]         = useState(true)
  const [search, setSearch]           = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortBy, setSortBy] = useState('name_asc')
  const [showModal, setShowModal]     = useState(false)
  const [editing, setEditing]         = useState<Brand | null>(null)
  const [selected, setSelected]       = useState<Brand | null>(null)
  const [view, setView]               = useState<'list' | 'grid'>('list')
  const [brandInfluencers, setBrandInfluencers] = useState<BrandInfluencer[]>([])
  const [loadingInf, setLoadingInf]   = useState(false)

  // Debounce search — only fire API after 350ms of no typing
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async (q = '') => {
    setLoading(true)
    try {
      const query = q ? `?search=${encodeURIComponent(q)}` : ''
      const res = await fetch(`/api/brands${query}`)
      const json = await res.json()
      setBrands(json.data ?? [])
    } catch {
      toast.error('Error al cargar marcas')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function handleSearchChange(value: string) {
    setSearch(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => load(value), 350)
  }

  async function loadBrandInfluencers(brand: Brand) {
    setLoadingInf(true)
    setBrandInfluencers([])
    try {
      const campaignIds = (brand.campaigns ?? []).map((c: {id:string}) => c.id)
      if (!campaignIds.length) { setLoadingInf(false); return }
      // Fetch influencers from all campaigns of this brand
      const results = await Promise.all(
        campaignIds.map((cid: string) =>
          fetch(`/api/campaigns/${cid}/influencers`).then(r => r.json()).then(j => ({
            campaign_id: cid,
            campaign_name: (brand.campaigns ?? []).find((c: {id:string;name:string}) => c.id === cid)?.name ?? '',
            influencers: j.data ?? [],
          }))
        )
      )
      const flat: BrandInfluencer[] = []
      const seen = new Set<string>()
      for (const r of results) {
        for (const ci of r.influencers) {
          if (!ci.influencer || seen.has(ci.influencer.id)) continue
          seen.add(ci.influencer.id)
          flat.push({
            id: ci.influencer.id,
            display_name: ci.influencer.display_name,
            avatar_url: ci.influencer.avatar_url,
            status: ci.status,
            campaign_name: r.campaign_name,
          })
        }
      }
      setBrandInfluencers(flat)
    } catch { /* non-fatal */ }
    setLoadingInf(false)
  }

  const statusLabel = (status?: string | null) => {
    if (status === 'approved') return 'Aprobada'
    if (status === 'suspended') return 'Suspendida'
    return 'Pendiente'
  }

  const statusClass = (status?: string | null) => {
    if (status === 'approved') return 'badge-green'
    if (status === 'suspended') return 'badge-red'
    return 'badge-orange'
  }

  const visibleBrands = useMemo(() => {
    const rows = [...brands]

    const filtered = statusFilter === 'all'
      ? rows
      : rows.filter(b => (b.status ?? 'pending_approval') === statusFilter)

    filtered.sort((a, b) => {
      const activeA = (a.campaigns ?? []).filter(c => c.status === 'active').length
      const activeB = (b.campaigns ?? []).filter(c => c.status === 'active').length
      const totalA = a.campaigns?.length ?? 0
      const totalB = b.campaigns?.length ?? 0

      if (sortBy === 'name_desc') return b.name.localeCompare(a.name)
      if (sortBy === 'active_desc') return activeB - activeA
      if (sortBy === 'campaigns_desc') return totalB - totalA
      if (sortBy === 'recent_access') {
        return new Date(b.last_sign_in_at ?? 0).getTime() - new Date(a.last_sign_in_at ?? 0).getTime()
      }
      return a.name.localeCompare(b.name)
    })

    return filtered
  }, [brands, statusFilter, sortBy])

  function openCreate() {
    setEditing(null)
    setShowModal(true)
  }

  function openEdit(b: Brand) {
    setEditing(b)
    setShowModal(true)
  }

  async function handleDelete(b: Brand) {
    if (!confirm(`¿Eliminar la marca "${b.name}"? Esto no eliminará las campañas asociadas.`)) return
    try {
      const res = await fetch(`/api/brands/${b.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      toast.success('Marca eliminada')
      setSelected(null)
      load(search)
    } catch {
      toast.error('Error al eliminar')
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Marcas</h1>
          <p className="text-sm text-gray-500 mt-0.5">Clientes y marcas asociadas a tus campañas</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white text-sm font-semibold rounded-lg hover:bg-violet-700 transition-colors"
        >
          <Plus className="h-4 w-4" /> Nueva marca
        </button>
      </div>

      {/* Search + view toggle */}
      <div className="flex items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            className="input-base pl-9 w-full"
            placeholder="Buscar marca..."
            value={search}
            onChange={e => handleSearchChange(e.target.value)}
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="input-base text-sm w-44"
        >
          <option value="all">Todas las marcas</option>
          <option value="pending_approval">Pendientes</option>
          <option value="approved">Aprobadas</option>
          <option value="suspended">Suspendidas</option>
        </select>

        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value)}
          className="input-base text-sm w-44"
        >
          <option value="name_asc">Orden A-Z</option>
          <option value="name_desc">Orden Z-A</option>
          <option value="active_desc">Más activas</option>
          <option value="campaigns_desc">Más campañas</option>
          <option value="recent_access">Último acceso</option>
        </select>

        <div className="flex rounded-lg border border-gray-200 overflow-hidden">
          <button onClick={() => setView('list')}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${view === 'list' ? 'bg-violet-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
            ☰ Lista
          </button>
          <button onClick={() => setView('grid')}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${view === 'grid' ? 'bg-violet-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
            ⊞ Grid
          </button>
        </div>
      </div>

      <div className="flex gap-5">
        {/* Grid */}
        <div className="flex-1 min-w-0">
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="card p-5 animate-pulse">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-12 h-12 rounded-xl bg-gray-100" />
                    <div className="flex-1">
                      <div className="h-4 bg-gray-100 rounded w-3/4 mb-2" />
                      <div className="h-3 bg-gray-100 rounded w-1/2" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : visibleBrands.length === 0 ? (
            <div className="card p-16 text-center max-w-md mx-auto">
              <Building2 className="h-12 w-12 text-gray-200 mx-auto mb-4" />
              <h3 className="text-lg font-bold text-gray-900 mb-1">
                {search ? 'Sin resultados' : 'Sin marcas aún'}
              </h3>
              <p className="text-sm text-gray-400 mb-4">
                {search ? `No se encontraron marcas para "${search}".` : 'Agrega las marcas con las que trabajas para asociarlas a campañas y facturas.'}
              </p>
              {!search && (
                <button
                  onClick={openCreate}
                  className="px-4 py-2 bg-violet-600 text-white text-sm font-semibold rounded-lg hover:bg-violet-700 transition-colors"
                >
                  + Crear primera marca
                </button>
              )}
            </div>
          ) : view === 'list' ? (
            /* ── List view ── */
            <div className="card overflow-x-auto">
              <table className="w-full min-w-[640px]">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    {['Marca', 'Estado', 'Industria', 'Contacto', 'Campañas activas', 'Total campañas', 'Última conexión', ''].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {visibleBrands.map((b: Brand) => {
                    const allCampaigns = (b.campaigns as Array<{id:string;name:string;status:string;budget_total:number|null;currency:string}>) ?? []
                    const activeCampaigns = allCampaigns.filter(camp => camp.status === 'active')
                    return (
                      <tr key={b.id} onClick={() => { const next = selected?.id === b.id ? null : b; setSelected(next); if (next) loadBrandInfluencers(next) }}
                        className={cn('cursor-pointer hover:bg-gray-50 transition-colors',
                          selected?.id === b.id ? 'bg-violet-50' : '')}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            {b.logo_url
                              ? <img src={b.logo_url} alt={b.name} className="w-8 h-8 rounded-lg object-contain border border-gray-100 p-0.5" />
                              : <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center text-violet-600 font-bold text-sm">{b.name[0]}</div>
                            }
                            <div>
                              <div className="text-sm font-semibold text-gray-900">{b.name}</div>
                              {b.website && <a href={b.website} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-xs text-violet-500 hover:underline truncate max-w-[160px] block">{b.website.replace(/^https?:\/\//, '')}</a>}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn('badge text-xs font-bold', statusClass(b.status))}>
                            {statusLabel(b.status)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500">{b.industry ?? '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-500">
                          {b.contact_name ?? '—'}
                          {b.contact_email && <div className="text-xs text-gray-400">{b.contact_email}</div>}
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn('badge text-xs font-bold', activeCampaigns.length > 0 ? 'badge-green' : 'badge-gray')}>
                            {activeCampaigns.length} activa{activeCampaigns.length !== 1 ? 's' : ''}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500">{allCampaigns.length} total</td>
                        <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                          {b.last_sign_in_at
                            ? new Date(b.last_sign_in_at).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                            : <span className="text-gray-300">Sin acceso</span>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button onClick={e => { e.stopPropagation(); setEditing(b); setShowModal(true) }}
                            className="text-xs text-violet-600 hover:underline font-medium">Editar</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {visibleBrands.map((b: Brand) => (
                <button
                  key={b.id}
                  onClick={() => { const next = selected?.id === b.id ? null : b; setSelected(next); if (next) loadBrandInfluencers(next) }}
                  className={cn(
                    'card p-5 text-left hover:shadow-md hover:-translate-y-0.5 transition-all',
                    selected?.id === b.id ? 'ring-2 ring-violet-400' : ''
                  )}
                >
                  <div className="flex items-start gap-3 mb-3">
                    {b.logo_url ? (
                      <img src={b.logo_url} alt={b.name} className="w-12 h-12 rounded-xl object-contain border border-gray-100 p-1" />
                    ) : (
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                        {initials(b.name)}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-gray-900 truncate">{b.name}</p>
                      {b.industry && <p className="text-xs text-gray-400 truncate">{b.industry}</p>}
                    </div>
                  </div>
                  <div className="space-y-1.5 text-xs text-gray-500">
                    {b.contact_email && (
                      <div className="flex items-center gap-1.5 truncate">
                        <Mail className="h-3 w-3 text-gray-300 flex-shrink-0" />
                        <span className="truncate">{b.contact_email}</span>
                      </div>
                    )}
                    {b.website && (
                      <div className="flex items-center gap-1.5 truncate">
                        <Globe className="h-3 w-3 text-gray-300 flex-shrink-0" />
                        <span className="truncate">{b.website.replace(/^https?:\/\//, '')}</span>
                      </div>
                    )}
                  </div>
                  {b.last_sign_in_at && (
                    <div className="mt-2 text-[10px] text-gray-400">
                      Últ. acceso: {new Date(b.last_sign_in_at).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </div>
                  )}
                  {(b.campaigns?.length ?? 0) > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-50 flex items-center gap-1.5 text-xs text-violet-600 font-medium">
                      <Target className="h-3 w-3" /> {b.campaigns!.length} campaña{b.campaigns!.length !== 1 ? 's' : ''}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selected && (
          <div className="w-80 flex-shrink-0">
            <div className="card p-5 space-y-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  {selected.logo_url ? (
                    <img src={selected.logo_url} alt={selected.name} className="w-14 h-14 rounded-xl object-contain border border-gray-100 p-1" />
                  ) : (
                    <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center text-white font-bold">
                      {initials(selected.name)}
                    </div>
                  )}
                  <div>
                    <h3 className="font-bold text-gray-900">{selected.name}</h3>
                    {selected.industry && <p className="text-xs text-gray-400">{selected.industry}</p>}
                  </div>
                </div>
                <button onClick={() => setSelected(null)} className="p-1 rounded-md hover:bg-gray-100 text-gray-400">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Contact */}
              <div className="space-y-2 text-sm">
                {selected.contact_name && <div className="text-gray-700 font-medium">{selected.contact_name}</div>}
                {selected.contact_email && (
                  <a href={`mailto:${selected.contact_email}`} className="flex items-center gap-2 text-violet-600 hover:underline">
                    <Mail className="h-3.5 w-3.5" /> {selected.contact_email}
                  </a>
                )}
                {selected.contact_phone && (
                  <div className="flex items-center gap-2 text-gray-600">
                    <Phone className="h-3.5 w-3.5 text-gray-400" /> {selected.contact_phone}
                  </div>
                )}
                {selected.website && (
                  <a href={selected.website} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 text-violet-600 hover:underline">
                    <ExternalLink className="h-3.5 w-3.5" /> {selected.website.replace(/^https?:\/\//, '')}
                  </a>
                )}
                {selected.notes && (
                  <div className="bg-amber-50 rounded-lg p-3 text-xs text-amber-800">{selected.notes}</div>
                )}
              </div>

              {/* Campaigns */}
              {(selected.campaigns?.length ?? 0) > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Campañas</p>
                  <div className="space-y-1.5">
                    {selected.campaigns!.map(c => (
                      <Link
                        key={c.id}
                        href={`/campaigns/${c.id}`}
                        className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 hover:bg-violet-50 transition-colors"
                      >
                        <span className="text-sm font-medium text-gray-800 truncate">{c.name}</span>
                        <span className={cn(
                          'badge text-[10px] flex-shrink-0',
                          c.status === 'active' ? 'badge-green' :
                          c.status === 'completed' ? 'badge-blue' :
                          c.status === 'draft' ? 'badge-gray' : 'badge-orange'
                        )}>
                          {c.status}
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* Influencers */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  Influencers {loadingInf && <span className="text-gray-300">cargando…</span>}
                </p>
                {brandInfluencers.length === 0 && !loadingInf && (
                  <p className="text-xs text-gray-400">Sin influencers en estas campañas.</p>
                )}
                <div className="space-y-1.5">
                  {brandInfluencers.map(inf => (
                    <a key={inf.id} href={`/influencers/${inf.id}`}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-gray-50 hover:bg-violet-50 transition-colors">
                      {inf.avatar_url ? (
                        <img src={inf.avatar_url} alt={inf.display_name} className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                      ) : (
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                          {inf.display_name.charAt(0)}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{inf.display_name}</p>
                        <p className="text-[10px] text-gray-400 truncate">{inf.campaign_name}</p>
                      </div>
                      <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0',
                        inf.status === 'active' ? 'bg-green-100 text-green-700' :
                        inf.status === 'applied' ? 'bg-amber-100 text-amber-700' :
                        'bg-gray-100 text-gray-500')}>
                        {inf.status === 'applied' ? '⏳ Solicitud' : inf.status === 'active' ? '✓ Activo' : inf.status}
                      </span>
                    </a>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-100">
                <button
                  onClick={async () => {
                    const res = await fetch(`/api/brands/${selected.id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ status: 'approved' }),
                    })
                    if (!res.ok) return toast.error('No se pudo aprobar')
                    toast.success('Marca aprobada')
                    load(search)
                    setSelected({ ...selected, status: 'approved' })
                  }}
                  className="py-2 text-xs font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                >
                  Aprobar marca
                </button>
                <button
                  onClick={async () => {
                    const res = await fetch(`/api/brands/${selected.id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ status: 'suspended' }),
                    })
                    if (!res.ok) return toast.error('No se pudo suspender')
                    toast.success('Marca suspendida')
                    load(search)
                    setSelected({ ...selected, status: 'suspended' })
                  }}
                  className="py-2 text-xs font-semibold bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors"
                >
                  Suspender
                </button>
              </div>

              {/* Actions */}
              <div className="space-y-2 pt-2 border-t border-gray-100">
                {/* Invitar al portal de marca */}
                {selected.contact_email && (
                  <button
                    onClick={async () => {
                      try {
                        const res = await fetch(`/api/brands/${selected.id}/invite`, { method: 'POST' })
                        const json = await res.json()
                        if (!res.ok) throw new Error(json.error)
                        toast.success(json.message)
                        if (json.action_link && !json.email_sent) {
                          navigator.clipboard.writeText(json.action_link).catch(() => {})
                          toast.info('Link copiado al portapapeles')
                        }
                      } catch (e) {
                        toast.error((e as Error).message)
                      }
                    }}
                    className="w-full flex items-center justify-center gap-1.5 py-2 text-sm font-semibold bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors"
                  >
                    <Send className="h-3.5 w-3.5" /> Invitar al portal
                  </button>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => openEdit(selected)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <Pencil className="h-3.5 w-3.5" /> Editar
                  </button>
                  <button
                    onClick={() => handleDelete(selected)}
                    className="flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-red-500 border border-red-100 rounded-lg hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal — rendered as module-level component, form state isolated from BrandsPage */}
      {showModal && (
        <BrandModal
          key={editing?.id ?? 'new'}
          editing={editing}
          onClose={() => setShowModal(false)}
          onSaved={() => load(search)}
        />
      )}
    </div>
  )
}
