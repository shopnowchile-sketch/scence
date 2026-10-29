'use client'

// Dirección estructurada: País → Región → Comuna (selectores dependientes sobre `locations`),
// calle y número, depto/información adicional y código postal. El único dato geográfico que
// se guarda es location_id (el nodo más específico elegido); nada de texto paralelo.
import { useEffect, useState } from 'react'
import type { AddressParts } from '@/lib/address-parts'

type Node = { id: string; name: string; level: string }

const LEVEL_LABEL: Record<string, string> = { country: 'País', region: 'Región', city: 'Ciudad', commune: 'Comuna' }
const SELECT_CLASS = 'w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none focus:border-violet-400'
const INPUT_CLASS = SELECT_CLASS

async function fetchNodes(query: string): Promise<Node[]> {
  try {
    const res = await fetch(`/api/influencer/locations?${query}`, { cache: 'no-store' })
    const json = await res.json()
    return res.ok ? (json.data ?? []) : []
  } catch { return [] }
}

type Props = {
  locationId: string
  parts: AddressParts
  onLocationChange: (id: string) => void
  onPartsChange: (parts: AddressParts) => void
}

export function StructuredAddressFields({ locationId, parts, onLocationChange, onPartsChange }: Props) {
  // levels[i] = opciones del nivel i; chain[i] = id elegido en ese nivel.
  const [levels, setLevels] = useState<Node[][]>([])
  const [chain, setChain] = useState<string[]>([])
  const [ready, setReady] = useState(false)

  // Carga inicial: reconstruye la cadena desde el location_id guardado (sin modificarlo).
  useEffect(() => {
    let alive = true
    ;(async () => {
      const ancestors = locationId ? await fetchNodes(`ancestors=${encodeURIComponent(locationId)}`) : []
      const nextLevels: Node[][] = [await fetchNodes('parent=root')]
      for (const node of ancestors) nextLevels.push(await fetchNodes(`parent=${encodeURIComponent(node.id)}`))
      if (!alive) return
      setChain(ancestors.map(n => n.id))
      setLevels(nextLevels.filter((opts, i) => i === 0 || opts.length > 0))
      setReady(true)
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function choose(depth: number, id: string) {
    const nextChain = [...chain.slice(0, depth), ...(id ? [id] : [])]
    const nextLevels = levels.slice(0, depth + 1)
    if (id) {
      const children = await fetchNodes(`parent=${encodeURIComponent(id)}`)
      if (children.length > 0) nextLevels.push(children)
    }
    setChain(nextChain)
    setLevels(nextLevels)
    onLocationChange(nextChain[nextChain.length - 1] ?? '')
  }

  const set = (key: keyof AddressParts, value: string) => onPartsChange({ ...parts, [key]: value })
  const isChile = levels[0]?.find(n => n.id === chain[0])?.name === 'Chile'

  return (
    <div className="space-y-3" data-testid="structured-address">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {levels.map((options, depth) => (
          <div key={depth}>
            <label className="mb-1 block text-xs font-semibold text-gray-500">{LEVEL_LABEL[options[0]?.level] ?? 'Zona'} *</label>
            <select value={chain[depth] ?? ''} onChange={e => void choose(depth, e.target.value)} disabled={!ready} className={SELECT_CLASS}>
              <option value="">Selecciona…</option>
              {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
        ))}
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold text-gray-500">Calle y número *</label>
        <input value={parts.street} onChange={e => set('street', e.target.value)} autoComplete="address-line1" placeholder="Av. Providencia 1234" className={INPUT_CLASS} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-500">Depto / adicional</label>
          <input value={parts.unit} onChange={e => set('unit', e.target.value)} autoComplete="address-line2" placeholder="Depto 5" className={INPUT_CLASS} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-500">Código postal</label>
          <input value={parts.postal_code} onChange={e => set('postal_code', e.target.value)} autoComplete="postal-code" inputMode="numeric" placeholder="Opcional" className={INPUT_CLASS} />
        </div>
      </div>
      {isChile && (
        <p className="text-[11px] text-gray-400">
          ¿No sabes tu código postal?{' '}
          <a href="https://www.correos.cl" target="_blank" rel="noopener noreferrer" className="font-semibold text-violet-600 underline">Búscalo en Correos de Chile</a>
        </p>
      )}
    </div>
  )
}
