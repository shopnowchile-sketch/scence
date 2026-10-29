'use client'

// Segmentación geográfica: dónde se muestra la campaña. Sin zonas = todas las influencers.
// País → Región → Comunas (varias) con selectores dependientes sobre `locations`; el botón
// "Agregar" suma el nivel más específico elegido. Misma pieza para Admin y Marca, en creación
// (sin id → zonas pendientes que el formulario guarda al crear) y en edición (API directa).
import { useEffect, useRef, useState } from 'react'
import { Check, Globe2, Loader2, Plus, X } from 'lucide-react'
import { latamCountryIds } from '@/lib/campaign-audience-latam'
import { SearchSelect, fetchNodes, type GeoNode } from '@/components/influencers/StructuredAddressFields'

export type AudienceZone = { id: string; name: string; level: string; parent?: string | null }

type Props = {
  campaignId: string | null
  canEdit?: boolean
  /** Solo creación (campaignId = null). */
  pending?: AudienceZone[]
  onPendingChange?: (next: AudienceZone[]) => void
}

const LEVEL_LABEL: Record<string, string> = { country: 'País', region: 'Región', city: 'Ciudad', commune: 'Comuna' }
const fold = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/** Guarda las zonas elegidas antes de que existiera la campaña. Devuelve true si se guardaron. */
export async function savePendingCampaignAudience(campaignId: string, zones: AudienceZone[]): Promise<boolean> {
  if (!zones.length) return true
  const res = await fetch(`/api/campaigns/${campaignId}/audience`, {
    method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ location_ids: zones.map(z => z.id) }),
  })
  return res.ok
}

// Lista con casillas y búsqueda: se pueden marcar varias comunas.
function MultiSelect({ label, options, selected, onToggle, onAll, onClear }: {
  label: string; options: GeoNode[]; selected: Set<string>
  onToggle: (id: string) => void; onAll: (ids: string[]) => void; onClear: () => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])
  const q = fold(query)
  const shown = q ? options.filter(o => fold(o.name).includes(q)) : options
  return (
    <div ref={box} className="relative">
      <label className="mb-1 block text-xs font-semibold text-gray-500">{label}</label>
      <input
        role="combobox" aria-expanded={open} aria-label={label}
        value={open ? query : selected.size ? `${selected.size} seleccionada${selected.size > 1 ? 's' : ''}` : ''}
        placeholder="Escribe o elige una o varias…"
        onFocus={() => { setQuery(''); setOpen(true) }}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
        className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-violet-400"
      />
      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 rounded-xl border border-gray-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-1.5 text-[11px] font-semibold text-violet-700">
            <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => onAll(shown.map(o => o.id))}>Marcar todas{q ? ' las filtradas' : ''}</button>
            <button type="button" onMouseDown={e => e.preventDefault()} onClick={onClear} className="text-gray-500">Limpiar</button>
          </div>
          <ul className="max-h-56 overflow-auto py-1">
            {shown.length === 0 && <li className="px-3 py-2 text-sm text-gray-400">Sin resultados</li>}
            {shown.map(o => {
              const on = selected.has(o.id)
              return (
                <li key={o.id}>
                  <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => onToggle(o.id)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-800 hover:bg-violet-50">
                    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? 'border-violet-600 bg-violet-600 text-white' : 'border-gray-300'}`}>{on && <Check className="h-3 w-3" />}</span>
                    {o.name}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

export function CampaignAudienceEditor({ campaignId, canEdit = true, pending = [], onPendingChange }: Props) {
  const isServer = Boolean(campaignId)
  const [serverZones, setServerZones] = useState<AudienceZone[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [countries, setCountries] = useState<GeoNode[]>([])
  const [regions, setRegions] = useState<GeoNode[]>([])
  const [communes, setCommunes] = useState<GeoNode[]>([])
  const [country, setCountry] = useState('')
  const [region, setRegion] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const zones = isServer ? serverZones : pending

  useEffect(() => {
    let alive = true
    fetchNodes('parent=root').then(list => { if (alive) setCountries(list) })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!campaignId) return
    let alive = true
    setBusy(true)
    fetch(`/api/campaigns/${campaignId}/audience`, { credentials: 'same-origin' })
      .then(r => r.json().then(j => ({ ok: r.ok, j })))
      .then(({ ok, j }) => { if (alive) { if (ok) setServerZones(j.data ?? []); else setError(j.error ?? 'No se pudo cargar') } })
      .catch(() => { if (alive) setError('No se pudo cargar') })
      .finally(() => { if (alive) setBusy(false) })
    return () => { alive = false }
  }, [campaignId])

  async function chooseCountry(id: string) {
    setCountry(id); setRegion(''); setRegions([]); setCommunes([]); setPicked(new Set())
    if (id) setRegions(await fetchNodes(`parent=${encodeURIComponent(id)}`))
  }
  async function chooseRegion(id: string) {
    setRegion(id); setCommunes([]); setPicked(new Set())
    if (id) setCommunes(await fetchNodes(`parent=${encodeURIComponent(id)}`))
  }

  async function commit(next: AudienceZone[]) {
    if (!isServer) { onPendingChange?.(next); return }
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/audience`, {
        method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location_ids: next.map(z => z.id) }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'No se pudo guardar')
      setServerZones(json.data ?? next)
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar') }
    finally { setBusy(false) }
  }

  const countryNode = countries.find(c => c.id === country)
  const regionNode = regions.find(r => r.id === region)
  // Lo que se agrega: comunas marcadas > región > país (siempre el nivel más específico elegido).
  const toAdd: AudienceZone[] = picked.size > 0
    ? communes.filter(c => picked.has(c.id)).map(c => ({ id: c.id, name: c.name, level: c.level, parent: regionNode?.name ?? null }))
    : regionNode ? [{ id: regionNode.id, name: regionNode.name, level: regionNode.level, parent: countryNode?.name ?? null }]
    : countryNode ? [{ id: countryNode.id, name: countryNode.name, level: countryNode.level }] : []
  const fresh = toAdd.filter(z => !zones.some(x => x.id === z.id))

  async function addSelected() {
    if (!fresh.length) return
    await commit([...zones, ...fresh])
    setPicked(new Set())
  }

  async function addLatam() {
    const ids = new Set(latamCountryIds(countries.map(c => ({ id: c.id, level: c.level, name: c.name }))))
    const merged = [...zones]
    for (const c of countries) if (ids.has(c.id) && !merged.some(z => z.id === c.id)) merged.push({ id: c.id, name: c.name, level: 'country' })
    await commit(merged)
  }

  const remove = (ids: string[]) => void commit(zones.filter(z => !ids.includes(z.id)))

  // Chips: si están todos los países LATAM se agrupan en uno solo.
  const latamIds = latamCountryIds(countries.map(c => ({ id: c.id, level: c.level, name: c.name })))
  const hasAllLatam = latamIds.length > 0 && latamIds.every(id => zones.some(z => z.id === id))
  const chips = [
    ...(hasAllLatam ? [{ key: 'latam', label: `LATAM · ${latamIds.length} países`, level: '', ids: latamIds }] : []),
    ...zones.filter(z => !(hasAllLatam && latamIds.includes(z.id))).map(z => ({ key: z.id, label: z.name, level: z.level, ids: [z.id] })),
  ]
  const addLabel = fresh.length === 0 ? 'Agregar'
    : picked.size > 0 ? `Agregar ${fresh.length} comuna${fresh.length > 1 ? 's' : ''}`
    : regionNode ? `Agregar toda ${regionNode.name}` : `Agregar todo ${countryNode?.name ?? ''}`

  return (
    <div className="space-y-3" data-testid="campaign-audience-editor">
      <div className="flex flex-wrap items-center gap-1.5">
        {chips.length === 0 && <span className="text-xs text-gray-500">Todas las influencers (sin restricción)</span>}
        {chips.map(chip => (
          <span key={chip.key} className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-800">
            {chip.label}{chip.level && <span className="text-[10px] text-violet-500">{LEVEL_LABEL[chip.level] ?? chip.level}</span>}
            {canEdit && <button type="button" onClick={() => remove(chip.ids)} disabled={busy} aria-label={`Quitar ${chip.label}`} className="rounded-full p-0.5 hover:bg-violet-100"><X className="h-3 w-3" /></button>}
          </span>
        ))}
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />}
      </div>

      {canEdit && (
        <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3 space-y-2.5">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <SearchSelect label="País" required={false} options={countries} value={country} onChange={id => void chooseCountry(id)} />
            {regions.length > 0 && <SearchSelect label="Región (opcional)" required={false} options={regions} value={region} onChange={id => void chooseRegion(id)} />}
            {communes.length > 0 && (
              <MultiSelect
                label="Comunas (opcional, varias)" options={communes} selected={picked}
                onToggle={id => setPicked(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })}
                onAll={ids => setPicked(prev => new Set([...Array.from(prev), ...ids]))}
                onClear={() => setPicked(new Set())}
              />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void addSelected()} disabled={busy || fresh.length === 0}
              className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-40">
              <Plus className="h-3.5 w-3.5" /> {addLabel}
            </button>
            <button type="button" onClick={() => void addLatam()} disabled={busy}
              className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-50">
              <Globe2 className="h-3.5 w-3.5" /> Todo LATAM
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}
