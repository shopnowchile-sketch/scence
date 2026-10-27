'use client'

/**
 * Puntos de venta de una marca: tiendas físicas (public.locations, type='store') y enlaces e-commerce
 * (brands.metadata). Un solo componente para Admin y Marca; solo cambia la API del selector.
 */

import { useCallback, useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { PhysicalLocationPicker } from '@/components/locations/PhysicalLocationPicker'

type Store = { id: string; name: string; address: string | null; city: string | null; region: string | null; country: string | null }
type EcommerceLink = { name: string; url: string }

export function SalesPointsPanel({ brandId, brandName, portal }: { brandId: string; brandName?: string; portal: 'admin' | 'brand' }) {
  const [stores, setStores] = useState<Store[]>([])
  const [ecommerce, setEcommerce] = useState<EcommerceLink[]>([])
  const [loading, setLoading] = useState(true)
  const [newLink, setNewLink] = useState({ name: '', url: '' })
  const base = `/api/brands/${brandId}/locations`

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(base)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Error cargando puntos de venta')
      setStores(json.data ?? [])
      setEcommerce(json.ecommerce ?? [])
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [base])

  useEffect(() => { load() }, [load])

  async function removeStore(store: Store) {
    if (!confirm(`¿Quitar el punto de venta "${store.name}"?`)) return
    const res = await fetch(`${base}/${store.id}`, { method: 'DELETE' })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return toast.error(json.error ?? 'No se pudo quitar')
    setStores(prev => prev.filter(s => s.id !== store.id))
    toast.success('Punto de venta quitado')
  }

  async function saveEcommerce(next: EcommerceLink[]) {
    const res = await fetch(base, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ecommerce: next }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return toast.error(json.error ?? 'No se pudo guardar el e-commerce')
    setEcommerce(json.ecommerce ?? next)
    setNewLink({ name: '', url: '' })
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <section className="card space-y-4 p-5">
        <div>
          <h2 className="font-bold text-gray-900">Agregar punto de venta</h2>
          <p className="mt-1 text-sm text-gray-500">Busca una tienda ya registrada o crea una nueva{brandName ? ` para ${brandName}` : ''}.</p>
        </div>
        <PhysicalLocationPicker
          apiBase={portal === 'admin' ? '/api/locations' : '/api/brand/locations'}
          brandId={portal === 'admin' ? brandId : null}
          placeType="store"
          onSelect={() => { load(); toast.success('Punto de venta agregado') }}
        />
        <div className="space-y-2 border-t border-gray-100 pt-4">
          <h3 className="text-sm font-bold text-gray-900">Agregar e-commerce</h3>
          <input className="input-base" placeholder="Nombre (ej: Tienda online)" value={newLink.name} onChange={e => setNewLink(v => ({ ...v, name: e.target.value }))} />
          <input className="input-base" placeholder="https://..." value={newLink.url} onChange={e => setNewLink(v => ({ ...v, url: e.target.value }))} />
          <button
            type="button"
            disabled={!newLink.name.trim() || !newLink.url.trim()}
            onClick={() => saveEcommerce([...ecommerce, newLink])}
            className="w-full rounded-lg bg-violet-600 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
          >
            Agregar e-commerce
          </button>
        </div>
      </section>

      <section className="card space-y-5 p-5 lg:col-span-2">
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold text-gray-900">Tiendas físicas</h2>
            <span className="text-sm text-gray-400">{stores.length}</span>
          </div>
          {loading ? (
            <p className="text-sm text-gray-400">Cargando…</p>
          ) : stores.length === 0 ? (
            <p className="text-sm text-gray-400">Aún no hay tiendas físicas.</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {stores.map(store => (
                <div key={store.id} className="flex items-start justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50 p-4">
                  <div className="min-w-0">
                    <p className="truncate font-bold text-gray-900">{store.name}</p>
                    <p className="mt-1 text-sm text-gray-500">{store.address || 'Sin dirección'}</p>
                    {(store.city || store.region) && (
                      <p className="mt-1 text-xs text-gray-400">{[store.city, store.region, store.country].filter(Boolean).join(', ')}</p>
                    )}
                  </div>
                  <button type="button" onClick={() => removeStore(store)} className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-100">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <h2 className="mb-3 font-bold text-gray-900">E-commerce</h2>
          {ecommerce.length === 0 ? (
            <p className="text-sm text-gray-400">Aún no hay enlaces de e-commerce.</p>
          ) : (
            <ul className="space-y-2">
              {ecommerce.map((link, i) => (
                <li key={`${link.url}-${i}`} className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                  <a href={link.url} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate text-sm font-semibold text-violet-700 hover:underline">
                    {link.name} <span className="font-normal text-gray-400">· {link.url}</span>
                  </a>
                  <button type="button" onClick={() => saveEcommerce(ecommerce.filter((_, j) => j !== i))} className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-100">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  )
}
