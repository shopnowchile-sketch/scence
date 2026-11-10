'use client'

// País → Región/Estado → Comuna/Ciudad contra el catálogo oficial `locations` (misma fuente que influencers,
// marcas y campañas, vía /api/influencer/locations). El CRM guarda NOMBRES (crm_leads.country/region/commune).
// Un valor ya guardado que no existe en el catálogo se muestra como «sin mapear» y se conserva mientras no se cambie.
import { useEffect, useMemo, useState } from 'react'
import { fetchNodes, type GeoNode } from '@/components/influencers/StructuredAddressFields'

export type CrmLocation = { country: string; region: string; commune: string }

const fold = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const byName = (list: GeoNode[], name: string) => list.find(n => fold(n.name) === fold(name))
const SELECT = 'w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-violet-400 disabled:opacity-60'

function Pick({ label, options, value, disabled, onChange }: {
  label: string; options: GeoNode[]; value: string; disabled?: boolean; onChange: (name: string) => void
}) {
  const unmapped = value && !byName(options, value)
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-gray-500">{label}</span>
      <select className={SELECT} value={value} disabled={disabled} onChange={e => onChange(e.target.value)} aria-label={label}>
        <option value="">—</option>
        {unmapped && <option value={value}>{value} (sin mapear)</option>}
        {options.map(o => <option key={o.id} value={o.name}>{o.name}</option>)}
      </select>
    </label>
  )
}

export function CrmLocationFields({ value, onChange, disabled }: { value: CrmLocation; onChange: (next: CrmLocation) => void; disabled?: boolean }) {
  const [countries, setCountries] = useState<GeoNode[]>([])
  const [regions, setRegions] = useState<GeoNode[]>([])
  const [communes, setCommunes] = useState<GeoNode[]>([])

  useEffect(() => {
    let alive = true
    fetchNodes('parent=root').then(list => { if (alive) setCountries(list) })
    return () => { alive = false }
  }, [])

  const countryId = useMemo(() => (value.country ? byName(countries, value.country)?.id ?? '' : ''), [countries, value.country])
  useEffect(() => {
    let alive = true
    setRegions([])
    if (countryId) fetchNodes(`parent=${encodeURIComponent(countryId)}`).then(list => { if (alive) setRegions(list) })
    return () => { alive = false }
  }, [countryId])

  const regionId = useMemo(() => (value.region ? byName(regions, value.region)?.id ?? '' : ''), [regions, value.region])
  useEffect(() => {
    let alive = true
    setCommunes([])
    if (regionId) fetchNodes(`parent=${encodeURIComponent(regionId)}`).then(list => { if (alive) setCommunes(list) })
    return () => { alive = false }
  }, [regionId])

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="crm-location-fields">
      <Pick label="País" options={countries} value={value.country} disabled={disabled}
        onChange={country => onChange({ country, region: '', commune: '' })} />
      <Pick label="Región / Estado" options={regions} value={value.region} disabled={disabled || (!countryId && !value.region)}
        onChange={region => onChange({ ...value, region, commune: '' })} />
      <Pick label="Comuna / Ciudad" options={communes} value={value.commune} disabled={disabled || (!regionId && !value.commune)}
        onChange={commune => onChange({ ...value, commune })} />
    </div>
  )
}
