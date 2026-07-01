'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Search, Plus, Check, ChevronDown, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'

type Brand = { id: string; name: string }

/**
 * BrandSelector — combobox con filtro por texto + creación de marca nueva inline.
 * Reemplaza el <select> plano (sin filtro, ~30 marcas en una sola lista) usado
 * antes en CampaignForm.tsx y CampaignEditForm.tsx (duplicado en ambos).
 */
export function BrandSelector({
  value,
  onChange,
}: {
  value: string
  onChange: (id: string) => void
}) {
  const [brands, setBrands]   = useState<Brand[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen]       = useState(false)
  const [query, setQuery]     = useState('')
  const [creating, setCreating] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/brands')
      .then(r => r.json())
      .then(j => setBrands((j.data ?? []).map((b: Brand) => ({ id: b.id, name: b.name }))))
      .catch(() => toast.error('No se pudieron cargar las marcas'))
      .finally(() => setLoading(false))
  }, [])

  // Cerrar al hacer clic afuera
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const selected = brands.find(b => b.id === value)
  const filtered = query.trim()
    ? brands.filter(b => b.name.toLowerCase().includes(query.trim().toLowerCase()))
    : brands

  const exactMatch = brands.some(b => b.name.toLowerCase() === query.trim().toLowerCase())

  async function createBrand() {
    const name = query.trim()
    if (!name) return
    setCreating(true)
    try {
      const res  = await fetch('/api/brands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      const newBrand = { id: json.data.id, name: json.data.name }
      setBrands(prev => [...prev, newBrand].sort((a, b) => a.name.localeCompare(b.name)))
      onChange(newBrand.id)
      toast.success(`Marca "${newBrand.name}" creada`)
      setQuery('')
      setOpen(false)
    } catch (e) {
      toast.error((e as Error).message)
    }
    setCreating(false)
  }

  return (
    <div ref={rootRef} className="relative">
      <label className="block text-sm font-medium text-gray-700 mb-1.5">
        Marca <span className="text-gray-400 text-xs">(opcional)</span>
      </label>

      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="input-base w-full flex items-center justify-between text-left"
      >
        <span className={cn(selected ? 'text-gray-900' : 'text-gray-400')}>
          {loading ? 'Cargando marcas…' : (selected?.name ?? 'Sin marca asignada')}
        </span>
        <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0" />
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100">
            <Search className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !exactMatch && query.trim()) createBrand() }}
              placeholder="Buscar o escribir para crear…"
              className="flex-1 text-sm outline-none"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} className="text-gray-300 hover:text-gray-500">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="max-h-56 overflow-y-auto">
            <button
              type="button"
              onClick={() => { onChange(''); setOpen(false); setQuery('') }}
              className="w-full flex items-center justify-between px-3 py-2 text-sm text-gray-500 hover:bg-gray-50 transition-colors"
            >
              Sin marca asignada
              {!value && <Check className="h-3.5 w-3.5 text-violet-600" />}
            </button>

            {filtered.map(b => (
              <button
                key={b.id}
                type="button"
                onClick={() => { onChange(b.id); setOpen(false); setQuery('') }}
                className="w-full flex items-center justify-between px-3 py-2 text-sm text-gray-800 hover:bg-gray-50 transition-colors"
              >
                {b.name}
                {value === b.id && <Check className="h-3.5 w-3.5 text-violet-600" />}
              </button>
            ))}

            {!loading && filtered.length === 0 && !query && (
              <p className="px-3 py-3 text-xs text-gray-400 text-center">No hay marcas registradas aún.</p>
            )}
          </div>

          {query.trim() && !exactMatch && (
            <button
              type="button"
              onClick={createBrand}
              disabled={creating}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-semibold text-violet-600 hover:bg-violet-50 border-t border-gray-100 transition-colors disabled:opacity-50"
            >
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Crear marca &quot;{query.trim()}&quot;
            </button>
          )}
        </div>
      )}
    </div>
  )
}
