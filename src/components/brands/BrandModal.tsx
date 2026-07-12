'use client'

import { useState } from 'react'
import { X, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

// Extraído de admin-brands/page.tsx para poder reusarlo también en el
// detalle de marca (admin-brands/[id]/page.tsx), que no tenía forma de
// editar. Misma lógica y mismos endpoints (POST/PATCH /api/brands),
// sin cambios de comportamiento.

export type BrandModalEditing = {
  id: string
  name: string
  logo_url: string | null
  website: string | null
  industry: string | null
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  notes: string | null
}

type FormData = {
  name: string; logo_url: string; website: string; industry: string
  contact_name: string; contact_email: string; contact_phone: string; notes: string
}

export const BRAND_INDUSTRIES = [
  'Moda & Belleza', 'Tecnología', 'Alimentación & Bebidas', 'Deportes & Fitness',
  'Viajes & Turismo', 'Entretenimiento', 'Salud & Bienestar', 'Automotriz',
  'Finanzas', 'Educación', 'Hogar & Deco', 'Otro',
]

const EMPTY_FORM: FormData = {
  name: '', logo_url: '', website: '', industry: '',
  contact_name: '', contact_email: '', contact_phone: '', notes: '',
}

export function BrandModal({
  editing,
  onClose,
  onSaved,
  createEndpoint = '/api/brands',
}: {
  editing: BrandModalEditing | null
  onClose: () => void
  onSaved: () => void
  createEndpoint?: string
}) {
  const [form, setForm] = useState<FormData>(() =>
    editing
      ? {
          name: editing.name,
          logo_url: editing.logo_url ?? '',
          website: editing.website ?? '',
          industry: editing.industry ?? '',
          contact_name: editing.contact_name ?? '',
          contact_email: editing.contact_email ?? '',
          contact_phone: editing.contact_phone ?? '',
          notes: editing.notes ?? '',
        }
      : EMPTY_FORM
  )
  const [saving, setSaving] = useState(false)

  const set = (k: keyof FormData, v: string) => setForm(f => ({ ...f, [k]: v }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    try {
      const url    = editing ? `/api/brands/${editing.id}` : createEndpoint
      const method = editing ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          logo_url:      form.logo_url || null,
          website:       form.website || null,
          industry:      form.industry || null,
          contact_name:  form.contact_name || null,
          contact_email: form.contact_email || null,
          contact_phone: form.contact_phone || null,
          notes:         form.notes || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Error al guardar')
      toast.success(editing ? 'Marca actualizada' : 'Marca creada ✓')
      onSaved()
      onClose()
    } catch (err: unknown) {
      toast.error((err as Error).message ?? 'Error desconocido')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">{editing ? 'Editar marca' : 'Nueva marca'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Nombre *</label>
            <input
              className="input-base w-full"
              value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder="Nike, Coca-Cola..."
              required
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Industria</label>
              <select className="input-base w-full" value={form.industry} onChange={e => set('industry', e.target.value)}>
                <option value="">— Selecciona —</option>
                {BRAND_INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Website</label>
              <input className="input-base w-full" value={form.website} onChange={e => set('website', e.target.value)} placeholder="https://..." />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Logo URL</label>
            <input className="input-base w-full" value={form.logo_url} onChange={e => set('logo_url', e.target.value)} placeholder="https://..." />
          </div>
          <div className="border-t border-gray-100 pt-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Contacto</p>
            <div className="space-y-3">
              <input className="input-base w-full" value={form.contact_name} onChange={e => set('contact_name', e.target.value)} placeholder="Nombre del contacto" />
              <input type="email" className="input-base w-full" value={form.contact_email} onChange={e => set('contact_email', e.target.value)} placeholder="email@marca.com" />
              <input className="input-base w-full" value={form.contact_phone} onChange={e => set('contact_phone', e.target.value)} placeholder="+52 55 1234 5678" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Notas internas</label>
            <textarea
              className="input-base w-full resize-none"
              rows={2}
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              placeholder="Condiciones especiales, contexto..."
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 text-sm font-semibold rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2 text-sm font-semibold rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-60 transition-colors flex items-center justify-center gap-2"
            >
              {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Guardando...</> : (editing ? 'Guardar cambios' : 'Crear marca')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
