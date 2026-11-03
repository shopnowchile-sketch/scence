'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'

type AgencyBrand = { id: string; name: string | null; status: string | null; is_agency_own: boolean; subscription_current: boolean }

/** Selector de marca activa de la agencia (Impulso Consulting). No renderiza nada para quien no es agencia. */
export function AgencyBrandSwitcher() {
  const [brands, setBrands] = useState<AgencyBrand[] | null>(null)
  const [active, setActive] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/brand/agency', { cache: 'no-store' })
      .then(res => (res.ok ? res.json() : null))
      .then(json => { if (alive && json?.is_agency) { setBrands(json.brands); setActive(json.active_brand_id) } })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  if (!brands) return null

  async function choose(brandId: string) {
    const res = await fetch('/api/brand/agency', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brand_id: brandId }) })
    if (!res.ok) { toast.error('No se pudo cambiar de marca'); return }
    window.location.assign('/brand-dash')
  }

  return (
    <div className="fixed bottom-3 left-3 z-40 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm">
      <label className="block text-[10px] uppercase tracking-wide text-gray-400">Marca activa</label>
      <select value={active ?? ''} onChange={e => void choose(e.target.value)} className="text-sm font-medium text-gray-800 bg-transparent outline-none max-w-[200px]">
        {brands.map(brand => (
          <option key={brand.id} value={brand.id}>{brand.name}{brand.subscription_current ? '' : ' · sin mensualidad'}</option>
        ))}
      </select>
    </div>
  )
}
