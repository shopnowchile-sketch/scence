'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Loader2, Plus, X, Pencil, MapPin, Lock, Search, ChevronRight, Globe2, Map as MapIcon, Building2,
  Landmark, Power, AlertTriangle,
} from 'lucide-react'
import { GooglePlacesAddress } from '@/components/brand/GooglePlacesAddress'
import { BrandSelector } from '@/components/campaigns/BrandSelector'
import {
  CHILD_LEVELS, LEVEL_LABELS, PLACE_TYPES, PLACE_TYPE_LABELS,
  type BreadcrumbItem, type LocationLevel, type LocationRow, type PlaceType,
} from '@/lib/locations'

type SearchRow = LocationRow & { breadcrumb: BreadcrumbItem[] }

const LEVEL_ICONS: Record<LocationLevel, typeof MapPin> = {
  country: Globe2, region: MapIcon, city: Building2, commune: Landmark, place: MapPin,
}

// Código ISO para restringir Google Places al país del breadcrumb.
// Sin código conocido se usa dirección manual.
const COUNTRY_CODES: Record<string, string> = {
  chile: 'CL', argentina: 'AR', peru: 'PE', colombia: 'CO', mexico: 'MX', espana: 'ES', 'estados unidos': 'US',
}
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error ?? 'Error')
  return json as T
}

// ── Selector de comuna (para asignar/mover un lugar) ─────────────────────────
function CommunePicker({ value, onChange }: { value: BreadcrumbItem | null; onChange: (c: BreadcrumbItem) => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<SearchRow[]>([])

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return }
    let stale = false
    const t = setTimeout(() => {
      api<{ data: SearchRow[] }>(`/api/locations?q=${encodeURIComponent(q)}`)
        .then(j => { if (!stale) setResults(j.data.filter(r => r.level === 'commune')) })
        .catch(() => { if (!stale) setResults([]) })
    }, 250)
    return () => { stale = true; clearTimeout(t) }
  }, [q])

  return (
    <div className="relative">
      {value && <p className="text-sm text-gray-800 mb-1">{value.name}</p>}
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar comuna…" className="input-base w-full" />
      {results.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full rounded-xl border border-gray-200 bg-white shadow-lg max-h-56 overflow-y-auto">
          {results.map(r => (
            <li key={r.id}>
              <button type="button" onClick={() => { onChange({ id: r.id, name: r.name, level: 'commune' }); setQ(''); setResults([]) }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-violet-50">
                {r.name} <span className="text-xs text-gray-400">· {r.breadcrumb.slice(0, -1).map(b => b.name).join(' › ')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Modal crear / editar ─────────────────────────────────────────────────────
type ModalState =
  | { mode: 'create'; level: LocationLevel; parent: BreadcrumbItem | null; trail: BreadcrumbItem[] }
  | { mode: 'edit'; node: LocationRow; trail: BreadcrumbItem[] }

function LocationModal({ state, onClose, onSaved }: { state: ModalState; onClose: () => void; onSaved: () => void }) {
  const node = state.mode === 'edit' ? state.node : null
  const level = state.mode === 'edit' ? state.node.level : state.level
  const isPlace = level === 'place'
  const trail = state.trail
  const countryCode = COUNTRY_CODES[norm(trail.find(b => b.level === 'country')?.name ?? '')] ?? ''

  const [form, setForm] = useState({
    name:       node?.name ?? '',
    type:       (node?.type ?? 'event') as PlaceType,
    address:    node?.address ?? '',
    lat:        node?.lat != null ? String(node.lat) : '',
    lng:        node?.lng != null ? String(node.lng) : '',
    is_private: node?.is_private ?? false,
    brand_id:   node?.brand_id ?? '',
    notes:      node?.notes ?? '',
  })
  const currentParent = state.mode === 'create' ? state.parent : (trail.length > 1 ? trail[trail.length - 2] : null)
  const [parent, setParent] = useState<BreadcrumbItem | null>(currentParent)
  const [communeHint, setCommuneHint] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Comuna: puede depender de su región o de una ciudad de esa región (city opcional).
  const [communeParents, setCommuneParents] = useState<BreadcrumbItem[]>([])
  const regionId = trail.find(b => b.level === 'region')?.id
  useEffect(() => {
    if (level !== 'commune' || state.mode !== 'edit' || !regionId) return
    api<{ data: LocationRow[]; breadcrumb: BreadcrumbItem[] }>(`/api/locations?parent_id=${regionId}`)
      .then(j => {
        const region = j.breadcrumb[j.breadcrumb.length - 1]
        const cities = j.data.filter(n => n.level === 'city').map(c => ({ id: c.id, name: c.name, level: 'city' as const }))
        setCommuneParents([region, ...cities])
      })
      .catch(() => setCommuneParents([]))
  }, [level, state.mode, regionId])

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm(p => ({ ...p, [k]: v }))
  const privateForced = form.type === 'influencer_home'

  async function save() {
    if (!form.name.trim()) { toast.error('El nombre es obligatorio'); return }
    if (isPlace && !parent) { toast.error('Asigna una comuna al lugar'); return }
    const payload: Record<string, unknown> = { name: form.name, notes: form.notes }
    if (isPlace) Object.assign(payload, {
      type: form.type, address: form.address, lat: form.lat, lng: form.lng,
      is_private: privateForced || form.is_private, brand_id: form.brand_id || null,
    })
    if (state.mode === 'create') Object.assign(payload, { level, parent_id: parent?.id ?? null })
    else if (parent?.id !== currentParent?.id) payload.parent_id = parent?.id ?? null

    setSaving(true)
    try {
      await api(state.mode === 'edit' ? `/api/locations/${state.node.id}` : '/api/locations', {
        method: state.mode === 'edit' ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      toast.success(state.mode === 'edit' ? 'Ubicación actualizada' : `${LEVEL_LABELS[level]} creada`)
      onSaved()
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <div>
            <h3 className="text-base font-bold text-gray-900">
              {state.mode === 'edit' ? `Editar ${LEVEL_LABELS[level].toLowerCase()}` : `Agregar ${LEVEL_LABELS[level].toLowerCase()}`}
            </h3>
            {currentParent && <p className="text-xs text-gray-400 mt-0.5">en {trail.filter(b => b.id !== node?.id).map(b => b.name).join(' › ')}</p>}
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X className="h-4 w-4 text-gray-400" /></button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nombre <span className="text-red-500">*</span></label>
            <input value={form.name} onChange={e => set('name', e.target.value)} className="input-base w-full"
              placeholder={isPlace ? 'Ej. Hotel W' : ''} />
          </div>

          {level === 'commune' && state.mode === 'edit' && communeParents.length > 1 && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Depende de</label>
              <select value={parent?.id ?? ''} className="input-base w-full bg-white"
                onChange={e => setParent(communeParents.find(p => p.id === e.target.value) ?? null)}>
                {communeParents.map(p => <option key={p.id} value={p.id}>{LEVEL_LABELS[p.level]}: {p.name}</option>)}
              </select>
            </div>
          )}

          {isPlace && (
            <>
              {state.mode === 'edit' && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Comuna <span className="text-red-500">*</span></label>
                  {!parent && <p className="text-xs text-amber-600 mb-1">Este lugar no tiene comuna asignada.</p>}
                  <CommunePicker value={parent} onChange={setParent} />
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Tipo</label>
                <select value={form.type} onChange={e => set('type', e.target.value as PlaceType)} className="input-base w-full bg-white">
                  {PLACE_TYPES.map(t => <option key={t} value={t}>{PLACE_TYPE_LABELS[t]}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Dirección</label>
                {countryCode ? (
                  <GooglePlacesAddress
                    countryCode={countryCode}
                    value={form.address}
                    onChange={v => set('address', v)}
                    onSelect={a => {
                      setForm(p => ({ ...p, lat: a.lat != null ? String(a.lat) : '', lng: a.lng != null ? String(a.lng) : '' }))
                      const commune = parent?.name
                      setCommuneHint(a.commune && commune && norm(a.commune) !== norm(commune)
                        ? `Google ubica esta dirección en ${a.commune}, no en ${commune}.` : null)
                    }}
                  />
                ) : (
                  <input value={form.address} onChange={e => set('address', e.target.value)} className="input-base w-full" placeholder="Calle y número" />
                )}
                {communeHint && <p className="text-xs text-amber-600 mt-1 flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{communeHint}</p>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Latitud</label>
                  <input value={form.lat} onChange={e => set('lat', e.target.value)} inputMode="decimal" className="input-base w-full" placeholder="Opcional" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Longitud</label>
                  <input value={form.lng} onChange={e => set('lng', e.target.value)} inputMode="decimal" className="input-base w-full" placeholder="Opcional" />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-gray-600">Marca dueña</label>
                  {form.brand_id && <button type="button" onClick={() => set('brand_id', '')} className="text-xs text-gray-400 hover:text-red-500">Quitar</button>}
                </div>
                <BrandSelector value={form.brand_id} onChange={id => set('brand_id', id)} />
              </div>

              {node?.owner_influencer_id && (
                <p className="text-xs text-gray-500">Domicilio vinculado a una influencer.</p>
              )}

              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={privateForced || form.is_private} disabled={privateForced}
                  onChange={e => set('is_private', e.target.checked)} />
                <span className="text-sm text-gray-700">
                  Lugar privado {privateForced && <span className="text-xs text-gray-400">(siempre privado para domicilios)</span>}
                </span>
              </label>
            </>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Notas</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} className="input-base w-full resize-none" />
          </div>

          <div className="flex gap-3 pt-2">
            <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 text-sm font-semibold text-gray-600 rounded-xl hover:bg-gray-50">Cancelar</button>
            <button onClick={save} disabled={saving}
              className="flex-1 py-2.5 text-sm font-semibold bg-violet-600 text-white rounded-xl hover:bg-violet-700 disabled:opacity-50 flex items-center justify-center gap-2">
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Página ───────────────────────────────────────────────────────────────────
export default function AdminSettingsLocationsPage() {
  const [parentId, setParentId]   = useState<string | null>(null)
  const [nodes, setNodes]         = useState<LocationRow[]>([])
  const [trail, setTrail]         = useState<BreadcrumbItem[]>([])
  const [loading, setLoading]     = useState(true)
  const [showInactive, setShowInactive] = useState(false)
  const [query, setQuery]         = useState('')
  const [results, setResults]     = useState<SearchRow[] | null>(null)
  const [modal, setModal]         = useState<ModalState | null>(null)
  const [toggling, setToggling]   = useState<string | null>(null)

  const inactiveParam = showInactive ? '&include_inactive=1' : ''

  const load = useCallback(() => {
    setLoading(true)
    api<{ data: LocationRow[]; breadcrumb: BreadcrumbItem[] }>(`/api/locations?parent_id=${parentId ?? ''}${inactiveParam}`)
      .then(j => { setNodes(j.data); setTrail(j.breadcrumb) })
      .catch(e => toast.error((e as Error).message))
      .finally(() => setLoading(false))
  }, [parentId, inactiveParam])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (query.trim().length < 2) { setResults(null); return }
    let stale = false
    const t = setTimeout(() => {
      api<{ data: SearchRow[] }>(`/api/locations?q=${encodeURIComponent(query)}${inactiveParam}`)
        .then(j => { if (!stale) setResults(j.data) })
        .catch(e => { if (!stale) toast.error((e as Error).message) })
    }, 250)
    return () => { stale = true; clearTimeout(t) }
  }, [query, inactiveParam])

  function open(id: string | null) { setQuery(''); setResults(null); setParentId(id) }

  async function editNode(n: LocationRow) {
    try {
      const j = await api<{ data: LocationRow; breadcrumb: BreadcrumbItem[] }>(`/api/locations/${n.id}`)
      setModal({ mode: 'edit', node: j.data, trail: j.breadcrumb })
    } catch (e) { toast.error((e as Error).message) }
  }

  async function toggleActive(n: LocationRow) {
    setToggling(n.id)
    try {
      await api(`/api/locations/${n.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !n.is_active }),
      })
      toast.success(n.is_active ? 'Desactivada' : 'Activada')
      load()
    } catch (e) { toast.error((e as Error).message) }
    setToggling(null)
  }

  const current = trail[trail.length - 1] ?? null
  const childLevels = CHILD_LEVELS[current?.level ?? 'root']

  function Row({ n, path }: { n: LocationRow; path?: BreadcrumbItem[] }) {
    const Icon = LEVEL_ICONS[n.level]
    const navigable = n.level !== 'place'
    const orphan = n.level === 'place' && !n.parent_id
    const go = () => {
      if (navigable) open(n.id)
      else if (path && path.length > 1) open(path[path.length - 2].id)
    }
    return (
      <li className={`flex items-center gap-3 px-5 py-3 hover:bg-gray-50/60 ${!n.is_active ? 'opacity-50' : ''}`}>
        <Icon className="h-4 w-4 text-violet-500 flex-shrink-0" />
        <button type="button" onClick={go} className="flex-1 min-w-0 text-left">
          <div className="text-sm font-medium text-gray-900 truncate flex items-center gap-2">
            {n.name}
            {n.is_private && <Lock className="h-3 w-3 text-gray-400" />}
            {!n.is_active && <span className="text-[10px] uppercase font-semibold text-gray-400">Inactiva</span>}
            {orphan && <span className="text-[10px] uppercase font-semibold text-amber-600 flex items-center gap-0.5"><AlertTriangle className="h-3 w-3" />Sin comuna</span>}
          </div>
          <div className="text-xs text-gray-400 truncate">
            {path
              ? path.slice(0, -1).map(b => b.name).join(' › ') || LEVEL_LABELS[n.level]
              : [LEVEL_LABELS[n.level], n.type && PLACE_TYPE_LABELS[n.type], n.address].filter(Boolean).join(' · ')}
          </div>
        </button>
        {navigable && n.children_count !== undefined && <span className="text-xs text-gray-400">{n.children_count}</span>}
        <button onClick={() => editNode(n)} className="p-1.5 hover:bg-gray-100 rounded-lg" title="Editar">
          <Pencil className="h-3.5 w-3.5 text-gray-400" />
        </button>
        <button onClick={() => toggleActive(n)} disabled={toggling === n.id} className="p-1.5 hover:bg-gray-100 rounded-lg"
          title={n.is_active ? 'Desactivar' : 'Activar'}>
          {toggling === n.id ? <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />
            : <Power className={`h-3.5 w-3.5 ${n.is_active ? 'text-gray-400' : 'text-emerald-500'}`} />}
        </button>
        {navigable && <ChevronRight className="h-4 w-4 text-gray-300" />}
      </li>
    )
  }

  return (
    <div className="max-w-3xl">
      {modal && <LocationModal state={modal} onClose={() => setModal(null)} onSaved={load} />}

      <div className="card overflow-visible">
        <div className="px-5 py-4 border-b border-gray-100 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-gray-900">Ubicaciones</h3>
              <p className="text-xs text-gray-400 mt-0.5">País › Región › (Ciudad) › Comuna › Lugar. Fuente única de ubicación de SCENCE.</p>
            </div>
            <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer whitespace-nowrap">
              <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Ver inactivas
            </label>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar comuna, región o lugar…" className="input-base w-full pl-9" />
          </div>
        </div>

        {results ? (
          results.length === 0
            ? <div className="p-8 text-center text-sm text-gray-400">Sin resultados.</div>
            : <ul className="divide-y divide-gray-50">{results.map(r => <Row key={r.id} n={r} path={r.breadcrumb} />)}</ul>
        ) : (
          <>
            <div className="px-5 py-3 border-b border-gray-50 flex flex-wrap items-center justify-between gap-2">
              <nav className="flex flex-wrap items-center gap-1 text-sm">
                <button onClick={() => open(null)} className={trail.length ? 'text-violet-600 hover:underline' : 'font-semibold text-gray-900'}>Todas</button>
                {trail.map((b, i) => (
                  <span key={b.id} className="flex items-center gap-1">
                    <ChevronRight className="h-3.5 w-3.5 text-gray-300" />
                    {i === trail.length - 1
                      ? <span className="font-semibold text-gray-900">{b.name}</span>
                      : <button onClick={() => open(b.id)} className="text-violet-600 hover:underline">{b.name}</button>}
                  </span>
                ))}
              </nav>
              <div className="flex gap-2">
                {childLevels.map(level => (
                  <button key={level}
                    onClick={() => setModal({ mode: 'create', level, parent: current, trail })}
                    className="flex items-center gap-1.5 text-sm font-semibold text-violet-600 hover:text-violet-700 border border-violet-200 rounded-xl px-3 py-1.5 hover:bg-violet-50">
                    <Plus className="h-3.5 w-3.5" /> {LEVEL_LABELS[level]}
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <div className="p-8 text-center text-sm text-gray-400">Cargando…</div>
            ) : nodes.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-400">Sin ubicaciones en este nivel.</div>
            ) : (
              <ul className="divide-y divide-gray-50">{nodes.map(n => <Row key={n.id} n={n} />)}</ul>
            )}
          </>
        )}
      </div>
    </div>
  )
}
