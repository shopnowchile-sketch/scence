'use client'

// Selector de lugares físicos (locations.level = 'place'). Un solo componente para
// los dos portales: lo único que cambia es la API.
//   · Admin  → /api/locations        (catálogo completo; nunca ofrece domicilios privados)
//   · Marca  → /api/brand/locations  (solo lugares propios; el servidor fuerza la marca)
// Basado en el selector del PR #85 (resolver de ubicaciones físicas).
import { useEffect, useMemo, useState } from 'react'
import { Check, Loader2, MapPin, Plus, Search, X } from 'lucide-react'

export type PlaceSelection = {
  locationId: string
  name: string
  address: string | null
  commune: string | null
  region: string | null
  country: string | null
}

type Node = {
  id: string; name: string; level: string; parent_id?: string | null
  address?: string | null; type?: string | null; is_private?: boolean
  breadcrumb?: { id: string; name: string; level: string }[]
}

type Props = {
  apiBase: '/api/locations' | '/api/brand/locations'
  /** Admin: marca dueña del lugar nuevo (la de la campaña), para que esa marca lo vea y administre. */
  brandId?: string | null
  excludeIds?: string[]
  disabled?: boolean
  onSelect: (place: PlaceSelection) => void
}

async function getNodes(apiBase: string, params = ''): Promise<Node[]> {
  const res = await fetch(apiBase + params)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error ?? 'No se pudieron cargar las ubicaciones')
  return json.data ?? []
}

/** Un domicilio de influencer jamás es dirección de campaña (también lo bloquea la base). */
const isSelectable = (n: Node) => n.level === 'place' && !n.is_private && n.type !== 'influencer_home'

function toSelection(place: Node, fallbackGeo?: { commune?: string; region?: string; country?: string }): PlaceSelection {
  const byLevel = (level: string) => place.breadcrumb?.find(i => i.level === level)?.name ?? null
  return {
    locationId: place.id,
    name: place.name,
    address: place.address ?? null,
    commune: byLevel('commune') ?? fallbackGeo?.commune ?? null,
    region: byLevel('region') ?? fallbackGeo?.region ?? null,
    country: byLevel('country') ?? fallbackGeo?.country ?? null,
  }
}

export function PhysicalLocationPicker({ apiBase, brandId = null, excludeIds = [], disabled = false, onSelect }: Props) {
  const isBrand = apiBase === '/api/brand/locations'
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Node[]>([])
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [countries, setCountries] = useState<Node[]>([])
  const [regions, setRegions] = useState<Node[]>([])
  const [communes, setCommunes] = useState<Node[]>([])
  const [countryId, setCountryId] = useState('')
  const [regionId, setRegionId] = useState('')
  const [communeId, setCommuneId] = useState('')
  const [placeName, setPlaceName] = useState('')
  const [address, setAddress] = useState('')

  useEffect(() => {
    if (!creating) return
    getNodes(apiBase).then(rows => setCountries(rows.filter(r => r.level === 'country'))).catch(e => setError(e.message))
  }, [creating, apiBase])

  useEffect(() => {
    setRegionId(''); setCommuneId(''); setCommunes([])
    if (!countryId) { setRegions([]); return }
    getNodes(apiBase, `?parent_id=${encodeURIComponent(countryId)}`)
      .then(rows => setRegions(rows.filter(r => r.level === 'region'))).catch(e => setError(e.message))
  }, [countryId, apiBase])

  useEffect(() => {
    setCommuneId('')
    if (!regionId) { setCommunes([]); return }
    // La región puede tener ciudades con comunas debajo: se aplanan para elegir directo la comuna.
    getNodes(apiBase, `?parent_id=${encodeURIComponent(regionId)}`).then(async rows => {
      const direct = rows.filter(r => r.level === 'commune')
      const nested = await Promise.all(rows.filter(r => r.level === 'city').map(city =>
        getNodes(apiBase, `?parent_id=${encodeURIComponent(city.id)}`).then(c => c.filter(x => x.level === 'commune'))))
      setCommunes([...direct, ...nested.flat()].sort((a, b) => a.name.localeCompare(b.name, 'es')))
    }).catch(e => setError(e.message))
  }, [regionId, apiBase])

  useEffect(() => {
    if (!open || creating) return
    const q = query.trim()
    // Marca: al abrir lista sus lugares. Admin: el catálogo es grande, solo busca con texto.
    if (!q && !isBrand) { setResults([]); return }
    const timer = window.setTimeout(async () => {
      setLoading(true); setError(null)
      try {
        const rows = await getNodes(apiBase, q ? `?q=${encodeURIComponent(q)}` : '?mine=1')
        setResults(rows.filter(isSelectable))
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error al buscar')
      } finally {
        setLoading(false)
      }
    }, q ? 250 : 0)
    return () => window.clearTimeout(timer)
  }, [query, open, creating, apiBase, isBrand])

  const canCreate = useMemo(
    () => !!countryId && !!regionId && !!communeId && !!placeName.trim() && !!address.trim(),
    [countryId, regionId, communeId, placeName, address],
  )

  function pick(place: PlaceSelection) {
    onSelect(place)
    setQuery(''); setResults([]); setOpen(false); setCreating(false); setError(null)
  }

  async function createPlace() {
    if (!canCreate) return
    setLoading(true); setError(null)
    try {
      const body = isBrand
        ? { name: placeName.trim(), parent_id: communeId, address: address.trim() }
        : { name: placeName.trim(), level: 'place', parent_id: communeId, type: brandId ? 'brand_venue' : 'event', address: address.trim(), brand_id: brandId || null }
      const res = await fetch(apiBase, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'No se pudo crear el lugar')
      const created = json.data as Node
      pick(toSelection(created, {
        commune: communes.find(x => x.id === communeId)?.name,
        region: regions.find(x => x.id === regionId)?.name,
        country: countries.find(x => x.id === countryId)?.name,
      }))
      setPlaceName(''); setAddress('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear el lugar')
    } finally {
      setLoading(false)
    }
  }

  const visible = results.filter(r => !excludeIds.includes(r.id))

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          className="input-base pl-9 pr-9"
          placeholder={isBrand ? 'Buscar entre mis lugares…' : 'Buscar lugar existente…'}
          value={query}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          aria-label="Buscar lugar"
        />
        {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-gray-400" />}
      </div>

      {open && !creating && (
        <div className="absolute z-30 mt-1 w-full rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden">
          <div className="flex justify-end border-b border-gray-50 px-2 py-1">
            <button type="button" onClick={() => setOpen(false)} className="p-1 text-gray-400 hover:text-gray-700" aria-label="Cerrar"><X className="h-3.5 w-3.5" /></button>
          </div>
          {visible.map(place => {
            const sel = toSelection(place)
            return (
              <button key={place.id} type="button" onClick={() => pick(sel)} className="w-full text-left px-3 py-2.5 hover:bg-gray-50 border-b border-gray-50">
                <div className="flex items-start gap-2">
                  <MapPin className="h-4 w-4 text-violet-500 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900">{place.name}</div>
                    <div className="text-xs text-gray-400 truncate">{[place.address, sel.commune].filter(Boolean).join(' · ') || 'Sin dirección'}</div>
                  </div>
                </div>
              </button>
            )
          })}
          {!loading && visible.length === 0 && (
            <div className="px-3 py-3 text-xs text-gray-400">
              {query.trim() ? 'No encontramos un lugar con ese nombre.' : isBrand ? 'Aún no tienes lugares guardados.' : 'Escribe para buscar un lugar.'}
            </div>
          )}
          <button type="button" onClick={() => setCreating(true)} className="w-full flex items-center gap-2 px-3 py-3 text-sm font-semibold text-violet-700 hover:bg-violet-50">
            <Plus className="h-4 w-4" /> Crear nuevo lugar
          </button>
        </div>
      )}

      {open && creating && (
        <div className="absolute z-30 mt-1 w-full rounded-xl border border-gray-200 bg-white shadow-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-gray-900">Crear nuevo lugar</div>
              <div className="text-[11px] text-gray-400">Queda guardado y podrás reutilizarlo en otras campañas.</div>
            </div>
            <button type="button" onClick={() => setCreating(false)} className="p-1 text-gray-400" aria-label="Volver"><X className="h-4 w-4" /></button>
          </div>

          <select className="input-base" value={countryId} onChange={e => setCountryId(e.target.value)} aria-label="País">
            <option value="">País *</option>
            {countries.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <select className="input-base" value={regionId} onChange={e => setRegionId(e.target.value)} disabled={!countryId} aria-label="Región">
            <option value="">Región *</option>
            {regions.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <select className="input-base" value={communeId} onChange={e => setCommuneId(e.target.value)} disabled={!regionId} aria-label="Comuna">
            <option value="">Comuna *</option>
            {communes.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <input className="input-base" placeholder="Nombre del lugar *" value={placeName} maxLength={120} onChange={e => setPlaceName(e.target.value)} />
          <input className="input-base" placeholder="Dirección (calle y número) *" value={address} maxLength={200} onChange={e => setAddress(e.target.value)} />

          {error && <div className="text-xs text-red-600">{error}</div>}

          <button type="button" disabled={!canCreate || loading} onClick={createPlace}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-40">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Guardar y agregar
          </button>
        </div>
      )}

      {error && !creating && <div className="mt-1 text-xs text-red-600">{error}</div>}
    </div>
  )
}
