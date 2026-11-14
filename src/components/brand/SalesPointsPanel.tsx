'use client'

/**
 * Lugares de una marca en una sola tabla: tiendas/locales físicos (public.locations, level='place'),
 * lugares compartidos por otras marcas (solo lectura) y enlaces e-commerce (brands.metadata).
 * Un componente para Admin y Marca; solo cambia la API de edición y del selector.
 */

import { useCallback, useEffect, useState } from 'react'
import { Lock, Pencil, Plus, PowerOff, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { PhysicalLocationPicker } from '@/components/locations/PhysicalLocationPicker'
import { SortableTH } from '@/components/ui/SortableTH'
import { PLACE_TYPE_LABELS, type PlaceType } from '@/lib/locations'
import { BRAND_PLACE_TYPES } from '@/lib/brand-places'

type Place = {
  id: string; name: string; address: string | null; type: PlaceType | null
  commune: string | null; region: string | null; shared?: boolean
}
type EcommerceLink = { name: string; url: string }

const PILL = 'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium'
const ICON_BTN = 'rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700'
const FIELD = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-violet-400'

export function SalesPointsPanel({ brandId, brandName, portal }: { brandId: string; brandName?: string; portal: 'admin' | 'brand' }) {
  const [places, setPlaces] = useState<Place[]>([])
  const [ecommerce, setEcommerce] = useState<EcommerceLink[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState<null | 'place' | 'ecommerce'>(null)
  const [newLink, setNewLink] = useState({ name: '', url: '' })
  const [editId, setEditId] = useState<string | null>(null)
  const [draft, setDraft] = useState({ name: '', address: '', type: 'store' as PlaceType })
  const [busy, setBusy] = useState(false)
  const base = `/api/brands/${brandId}/locations`
  // La edición usa las APIs que ya existen (cada una valida propiedad y permisos en el servidor).
  const editBase = portal === 'admin' ? '/api/locations' : '/api/brand/locations'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(base)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Error cargando lugares')
      setPlaces(json.data ?? [])
      setEcommerce(json.ecommerce ?? [])
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [base])
  useEffect(() => { load() }, [load])

  async function deactivate(place: Place) {
    if (!confirm(`¿Desactivar "${place.name}"? Las campañas que ya lo usan lo conservan; no se ofrecerá para nuevas.`)) return
    const res = await fetch(`${base}/${place.id}`, { method: 'DELETE' })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return toast.error(json.error ?? 'No se pudo desactivar')
    setPlaces(prev => prev.filter(p => p.id !== place.id))
    toast.success('Lugar desactivado')
  }

  function startEdit(place: Place) {
    setEditId(place.id)
    setDraft({ name: place.name, address: place.address ?? '', type: (place.type ?? 'store') as PlaceType })
  }

  async function saveEdit(id: string) {
    setBusy(true)
    try {
      const res = await fetch(`${editBase}/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: draft.name, address: draft.address, type: draft.type }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) return toast.error(json.error ?? 'No se pudo guardar')
      toast.success('Lugar actualizado')
      setEditId(null)
      await load()
    } finally { setBusy(false) }
  }

  async function saveEcommerce(next: EcommerceLink[]) {
    const res = await fetch(base, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ecommerce: next }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return toast.error(json.error ?? 'No se pudo guardar el e-commerce')
    setEcommerce(json.ecommerce ?? next)
    setNewLink({ name: '', url: '' })
    setAdding(null)
  }

  const total = places.length + ecommerce.length

  return (
    <section className="space-y-4" data-testid="places-table">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">
          Lugares <span className="ml-1 font-normal text-gray-400">{total}</span>
        </h2>
        <button type="button" onClick={() => setAdding(adding ? null : 'place')}
          className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700">
          {adding ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {adding ? 'Cerrar' : 'Agregar lugar'}
        </button>
      </div>

      {adding && (
        <div className="space-y-3 border-y border-gray-100 py-4">
          <div className="inline-flex rounded-lg bg-gray-100 p-0.5 text-sm">
            {([['place', 'Lugar físico'], ['ecommerce', 'E-commerce']] as const).map(([key, label]) => (
              <button key={key} type="button" onClick={() => setAdding(key)}
                className={`rounded-md px-3 py-1 font-medium transition-colors ${adding === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                {label}
              </button>
            ))}
          </div>
          {adding === 'place' ? (
            <PhysicalLocationPicker
              apiBase={portal === 'admin' ? '/api/locations' : '/api/brand/locations'}
              brandId={portal === 'admin' ? brandId : null}
              placeType="store"
              onSelect={() => { load(); setAdding(null); toast.success('Lugar agregado') }}
            />
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_2fr_auto]">
              <input className={FIELD} placeholder="Nombre (ej: Tienda online)" value={newLink.name} onChange={e => setNewLink(v => ({ ...v, name: e.target.value }))} />
              <input className={FIELD} placeholder="https://…" value={newLink.url} onChange={e => setNewLink(v => ({ ...v, url: e.target.value }))} />
              <button type="button" disabled={!newLink.name.trim() || !newLink.url.trim()} onClick={() => saveEcommerce([...ecommerce, newLink])}
                className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50">
                Agregar
              </button>
            </div>
          )}
          {brandName && <p className="text-xs text-gray-400">Se agregará a {brandName}.</p>}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-400">Cargando…</p>
      ) : total === 0 ? (
        <p className="py-6 text-sm text-gray-400">Aún no hay lugares. Usa «Agregar lugar» para registrar el primero.</p>
      ) : (
        <div className="overflow-x-auto">
          {/* Encabezados con SortableTH (sin `col`): listos para ordenar/filtrar más adelante. */}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <SortableTH className="!bg-transparent">Nombre</SortableTH>
                <SortableTH className="!bg-transparent hidden md:table-cell">Tipo</SortableTH>
                <SortableTH className="!bg-transparent">Dirección</SortableTH>
                <SortableTH className="!bg-transparent hidden lg:table-cell">Comuna</SortableTH>
                <SortableTH className="!bg-transparent hidden lg:table-cell">Región</SortableTH>
                <SortableTH className="!bg-transparent">Estado</SortableTH>
                <SortableTH className="!bg-transparent" align="right">Acciones</SortableTH>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {places.map(place => (
                editId === place.id ? (
                  <tr key={place.id} className="bg-gray-50/60">
                    <td colSpan={7} className="px-4 py-3">
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_10rem_2fr_auto_auto]">
                        <input className={FIELD} value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} aria-label="Nombre" />
                        <select className={FIELD} value={draft.type} onChange={e => setDraft(d => ({ ...d, type: e.target.value as PlaceType }))} aria-label="Tipo">
                          {BRAND_PLACE_TYPES.map(t => <option key={t} value={t}>{PLACE_TYPE_LABELS[t]}</option>)}
                        </select>
                        <input className={FIELD} value={draft.address} onChange={e => setDraft(d => ({ ...d, address: e.target.value }))} aria-label="Dirección" />
                        <button type="button" disabled={busy || !draft.name.trim() || !draft.address.trim()} onClick={() => saveEdit(place.id)}
                          className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50">Guardar</button>
                        <button type="button" onClick={() => setEditId(null)} className="rounded-lg px-3 py-2 text-sm text-gray-500 hover:text-gray-800">Cancelar</button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={place.id}>
                    <td className="px-4 py-3 font-medium text-gray-900">{place.name}</td>
                    <td className="hidden px-4 py-3 text-gray-500 md:table-cell">{place.type ? PLACE_TYPE_LABELS[place.type] : '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{place.address || <span className="text-gray-300">Sin dirección</span>}</td>
                    <td className="hidden px-4 py-3 text-gray-500 lg:table-cell">{place.commune ?? '—'}</td>
                    <td className="hidden px-4 py-3 text-gray-500 lg:table-cell">{place.region ?? '—'}</td>
                    <td className="px-4 py-3">
                      {place.shared
                        ? <span className={`${PILL} bg-violet-50 text-violet-700`}>Compartido</span>
                        : <span className={`${PILL} bg-emerald-50 text-emerald-700`}>Activo</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {place.shared ? (
                        <span className="inline-flex items-center gap-1 text-xs text-gray-400" title="Compartido por otra marca: solo lectura"><Lock className="h-3 w-3" />Solo lectura</span>
                      ) : (
                        <span className="inline-flex gap-0.5">
                          <button type="button" className={ICON_BTN} onClick={() => startEdit(place)} title="Editar" aria-label={`Editar ${place.name}`}><Pencil className="h-3.5 w-3.5" /></button>
                          <button type="button" className={`${ICON_BTN} hover:!text-red-600`} onClick={() => deactivate(place)} title="Desactivar" aria-label={`Desactivar ${place.name}`}><PowerOff className="h-3.5 w-3.5" /></button>
                        </span>
                      )}
                    </td>
                  </tr>
                )
              ))}
              {ecommerce.map((link, i) => (
                <tr key={`${link.url}-${i}`}>
                  <td className="px-4 py-3 font-medium text-gray-900">{link.name}</td>
                  <td className="hidden px-4 py-3 text-gray-500 md:table-cell">E-commerce</td>
                  <td className="max-w-[18rem] truncate px-4 py-3">
                    <a href={link.url} target="_blank" rel="noopener noreferrer" className="text-violet-700 hover:underline">{link.url}</a>
                  </td>
                  <td className="hidden px-4 py-3 text-gray-300 lg:table-cell">—</td>
                  <td className="hidden px-4 py-3 text-gray-300 lg:table-cell">—</td>
                  <td className="px-4 py-3"><span className={`${PILL} bg-emerald-50 text-emerald-700`}>Activo</span></td>
                  <td className="px-4 py-3 text-right">
                    <button type="button" className={`${ICON_BTN} hover:!text-red-600`} onClick={() => saveEcommerce(ecommerce.filter((_, j) => j !== i))} title="Quitar" aria-label={`Quitar ${link.name}`}><Trash2 className="h-3.5 w-3.5" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
