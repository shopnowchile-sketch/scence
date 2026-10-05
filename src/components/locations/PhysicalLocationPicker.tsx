'use client'

import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, Loader2, MapPin, Plus, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { LocationRow } from '@/lib/locations'

export type PhysicalLocationValue = {
  locationId: string | null
  locationDisplay: string | null
}

type Props = {
  value: PhysicalLocationValue
  onChange: (value: PhysicalLocationValue) => void
  disabled?: boolean
}

type Node = Pick<LocationRow, 'id' | 'name' | 'level' | 'parent_id' | 'address' | 'type'>
type SearchNode = Node & { breadcrumb?: { id: string; name: string; level: string }[] }

async function getLocations(params = ''): Promise<SearchNode[]> {
  const res = await fetch('/api/locations/physical' + params)
  const json = await res.json()
  if (!res.ok) throw new Error(json.error ?? 'No se pudieron cargar las ubicaciones')
  return json.data ?? []
}

export function PhysicalLocationPicker({ value, onChange, disabled = false }: Props) {
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
    getLocations()
      .then(setCountries)
      .catch(e => setError(e.message))
  }, [creating])

  useEffect(() => {
    if (!countryId) {
      setRegions([])
      setRegionId('')
      setCommunes([])
      setCommuneId('')
      return
    }
    getLocations(`?parent_id=${encodeURIComponent(countryId)}`)
      .then(setRegions)
      .catch(e => setError(e.message))
  }, [countryId])

  useEffect(() => {
    if (!regionId) {
      setCommunes([])
      setCommuneId('')
      return
    }
    getLocations(`?parent_id=${encodeURIComponent(regionId)}`)
      .then(setCommunes)
      .catch(e => setError(e.message))
  }, [regionId])

  useEffect(() => {
    if (!open || creating) return
    const timer = window.setTimeout(async () => {
      const q = query.trim()
      if (!q) {
        setResults([])
        return
      }
      setLoading(true)
      setError(null)
      try {
        const rows = await getLocations(`?q=${encodeURIComponent(q)}`)
        setResults(rows.filter(r => r.level === 'place'))
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error al buscar')
      } finally {
        setLoading(false)
      }
    }, 250)
    return () => window.clearTimeout(timer)
  }, [query, open, creating])

  const canCreate = useMemo(
    () => !!countryId && !!regionId && !!communeId && !!placeName.trim() && !!address.trim(),
    [countryId, regionId, communeId, placeName, address],
  )

  function selectPlace(place: SearchNode) {
    const geography = (place.breadcrumb ?? [])
      .filter(item => item.level !== 'place')
      .map(item => item.name)
      .join(' · ')
    onChange({
      locationId: place.id,
      locationDisplay: [place.name, geography, place.address].filter(Boolean).join(' — '),
    })
    setQuery('')
    setResults([])
    setOpen(false)
    setCreating(false)
    setError(null)
  }

  async function createPlace() {
    if (!canCreate) return
    setLoading(true)
    setError(null)
    try {
      const commune = communes.find(x => x.id === communeId)?.name
      const region = regions.find(x => x.id === regionId)?.name
      const country = countries.find(x => x.id === countryId)?.name
      const res = await fetch('/api/locations/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venueName: placeName.trim(),
          address: address.trim(),
          commune,
          region,
          country,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'No se pudo crear el lugar')
      const created = json.location as Node
      onChange({
        locationId: created.id,
        locationDisplay: [created.name, [commune, region, country].filter(Boolean).join(' · '), created.address]
          .filter(Boolean).join(' — '),
      })
      setCreating(false)
      setOpen(false)
      setPlaceName('')
      setAddress('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear el lugar')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative">
      <label className="label">Lugar del evento</label>

      {value.locationId ? (
        <div className="flex items-start gap-3 rounded-xl border border-violet-200 bg-violet-50/60 p-3">
          <MapPin className="h-4 w-4 text-violet-600 mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-gray-900">{value.locationDisplay ?? 'Lugar seleccionado'}</div>
            <div className="text-[11px] text-violet-600 mt-0.5">Ubicación física canónica</div>
          </div>
          <button
            type="button"
            onClick={() => onChange({ locationId: null, locationDisplay: null })}
            className="p-1 text-gray-400 hover:text-gray-700"
            aria-label="Cambiar lugar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              className="input-base pl-9 pr-9"
              placeholder="Buscar lugar existente..."
              value={query}
              disabled={disabled}
              onFocus={() => setOpen(true)}
              onChange={e => setQuery(e.target.value)}
            />
            {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-gray-400" />}
          </div>

          {open && !creating && (
            <div className="absolute z-30 mt-1 w-full rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden">
              {results.map(place => (
                <button
                  key={place.id}
                  type="button"
                  onClick={() => selectPlace(place)}
                  className="w-full text-left px-3 py-2.5 hover:bg-gray-50 border-b border-gray-50"
                >
                  <div className="flex items-start gap-2">
                    <MapPin className="h-4 w-4 text-violet-500 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900">{place.name}</div>
                      <div className="text-xs text-gray-400 truncate">{place.address ?? 'Sin dirección'}</div>
                    </div>
                  </div>
                </button>
              ))}
              {query.trim() && !loading && results.length === 0 && (
                <div className="px-3 py-3 text-xs text-gray-400">No encontramos un lugar físico.</div>
              )}
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="w-full flex items-center gap-2 px-3 py-3 text-sm font-semibold text-violet-700 hover:bg-violet-50"
              >
                <Plus className="h-4 w-4" /> Crear nuevo lugar
              </button>
            </div>
          )}

          {open && creating && (
            <div className="absolute z-30 mt-1 w-full rounded-xl border border-gray-200 bg-white shadow-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-gray-900">Crear nuevo lugar</div>
                  <div className="text-[11px] text-gray-400">Completa la jerarquía para guardar un place canónico.</div>
                </div>
                <button type="button" onClick={() => setCreating(false)} className="p-1 text-gray-400"><X className="h-4 w-4" /></button>
              </div>

              <select className="input-base" value={countryId} onChange={e => setCountryId(e.target.value)}>
                <option value="">País *</option>
                {countries.filter(x => x.level === 'country').map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>

              <select className="input-base" value={regionId} onChange={e => setRegionId(e.target.value)} disabled={!countryId}>
                <option value="">Región *</option>
                {regions.filter(x => x.level === 'region').map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>

              <select className="input-base" value={communeId} onChange={e => setCommuneId(e.target.value)} disabled={!regionId}>
                <option value="">Comuna *</option>
                {communes.filter(x => x.level === 'commune').map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>

              <input className="input-base" placeholder="Nombre del lugar *" value={placeName} onChange={e => setPlaceName(e.target.value)} />
              <input className="input-base" placeholder="Dirección *" value={address} onChange={e => setAddress(e.target.value)} />

              {error && <div className="text-xs text-red-600">{error}</div>}

              <button
                type="button"
                disabled={!canCreate || loading}
                onClick={createPlace}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Guardar lugar
              </button>
            </div>
          )}

          {error && !creating && <div className="mt-1 text-xs text-red-600">{error}</div>}
        </>
      )}
    </div>
  )
}
