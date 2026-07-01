'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Plus, X, Pencil, Trash2, MapPin, Lock, Globe } from 'lucide-react'

type Location = {
  id: string
  name: string
  type: string
  address: string | null
  city: string | null
  region: string | null
  country: string | null
  is_private: boolean
  notes: string | null
}

const TYPE_LABELS: Record<string, string> = {
  office:           'Oficina',
  event_venue:      'Lugar de evento',
  studio:           'Estudio',
  brand_venue:      'Local de marca',
  influencer_home:  'Casa de influencer',
  other:            'Otro',
}

const TYPE_OPTIONS = Object.keys(TYPE_LABELS)

function LocationModal({
  initial,
  onClose,
  onSaved,
}: {
  initial: Location | null
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState({
    name:       initial?.name ?? '',
    type:       initial?.type ?? 'office',
    address:    initial?.address ?? '',
    city:       initial?.city ?? '',
    region:     initial?.region ?? '',
    country:    initial?.country ?? 'Chile',
    is_private: initial?.is_private ?? false,
    notes:      initial?.notes ?? '',
  })
  const [saving, setSaving] = useState(false)

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm(prev => ({ ...prev, [k]: v }))
  }

  async function save() {
    if (!form.name.trim()) { toast.error('El nombre es requerido'); return }
    setSaving(true)
    try {
      const res = await fetch(initial ? `/api/locations/${initial.id}` : '/api/locations', {
        method: initial ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success(initial ? 'Lugar actualizado' : 'Lugar creado')
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
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white">
          <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <MapPin className="h-4 w-4 text-violet-500" /> {initial ? 'Editar lugar' : 'Agregar lugar'}
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg">
            <X className="h-4 w-4 text-gray-400" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nombre <span className="text-red-500">*</span></label>
            <input value={form.name} onChange={e => set('name', e.target.value)}
              placeholder="Ej. Estudio Providencia"
              className="input-base w-full" />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Tipo</label>
            <select value={form.type} onChange={e => set('type', e.target.value)}
              className="input-base w-full bg-white">
              {TYPE_OPTIONS.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Dirección</label>
            <input value={form.address} onChange={e => set('address', e.target.value)}
              placeholder="Calle y número" className="input-base w-full" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Ciudad</label>
              <input value={form.city} onChange={e => set('city', e.target.value)} className="input-base w-full" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Región</label>
              <input value={form.region} onChange={e => set('region', e.target.value)} className="input-base w-full" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">País</label>
            <input value={form.country} onChange={e => set('country', e.target.value)} className="input-base w-full" />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.is_private} onChange={e => set('is_private', e.target.checked)} />
            <span className="text-sm text-gray-700">Lugar privado (no visible para otras marcas/influencers)</span>
          </label>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Notas</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2}
              className="input-base w-full resize-none" />
          </div>

          <div className="flex gap-3 pt-2">
            <button onClick={onClose}
              className="flex-1 py-2.5 border border-gray-200 text-sm font-semibold text-gray-600 rounded-xl hover:bg-gray-50">
              Cancelar
            </button>
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

export default function AdminSettingsLocationsPage() {
  const [locations, setLocations] = useState<Location[]>([])
  const [loading, setLoading]     = useState(true)
  const [modalFor, setModalFor]   = useState<Location | 'new' | null>(null)
  const [deleting, setDeleting]   = useState<string | null>(null)

  function load() {
    setLoading(true)
    fetch('/api/locations')
      .then(r => r.json())
      .then(j => setLocations(j.data ?? []))
      .catch(() => toast.error('Error al cargar lugares'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  async function remove(id: string) {
    if (!confirm('¿Borrar este lugar?')) return
    setDeleting(id)
    try {
      const res = await fetch(`/api/locations/${id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Lugar eliminado')
      setLocations(prev => prev.filter(l => l.id !== id))
    } catch (e) {
      toast.error((e as Error).message)
    }
    setDeleting(null)
  }

  return (
    <div className="max-w-3xl">
      {modalFor && (
        <LocationModal
          initial={modalFor === 'new' ? null : modalFor}
          onClose={() => setModalFor(null)}
          onSaved={load}
        />
      )}

      <div className="card overflow-x-auto">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-gray-900">Lugares</h3>
            <p className="text-xs text-gray-400 mt-0.5">Administra los lugares asociados a campañas, marcas y activaciones</p>
          </div>
          <button
            onClick={() => setModalFor('new')}
            className="flex items-center gap-1.5 text-sm font-semibold text-violet-600 hover:text-violet-700 border border-violet-200 rounded-xl px-3 py-1.5 hover:bg-violet-50 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" /> Agregar
          </button>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">Cargando…</div>
        ) : locations.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">No hay lugares registrados aún.</div>
        ) : (
          <table className="w-full min-w-[560px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                {['Nombre', 'Tipo', 'Ciudad', 'Visibilidad', ''].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {locations.map(l => (
                <tr key={l.id} className="hover:bg-gray-50/50">
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium text-gray-900">{l.name}</div>
                    {l.address && <div className="text-xs text-gray-400">{l.address}</div>}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">{TYPE_LABELS[l.type] ?? l.type}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{l.city || '—'}</td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-1 text-xs text-gray-500">
                      {l.is_private ? <><Lock className="h-3 w-3" /> Privado</> : <><Globe className="h-3 w-3" /> Público</>}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <button onClick={() => setModalFor(l)} className="p-1.5 hover:bg-gray-100 rounded-lg">
                        <Pencil className="h-3.5 w-3.5 text-gray-400" />
                      </button>
                      <button onClick={() => remove(l.id)} disabled={deleting === l.id} className="p-1.5 hover:bg-red-50 rounded-lg">
                        {deleting === l.id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin text-red-400" />
                          : <Trash2 className="h-3.5 w-3.5 text-red-400" />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
