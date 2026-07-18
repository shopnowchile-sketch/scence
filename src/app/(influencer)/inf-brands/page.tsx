'use client'

import { useCallback, useEffect, useState } from 'react'
import { Building2, ExternalLink, Instagram, Loader2, Mail, Pencil, Phone, Plus, Trash2, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import Image from 'next/image'

type OwnedBrand = {
  id: string; organization_id: string; name: string; industry: string | null; status: 'pending_approval' | 'approved' | 'rejected'; contact_name: string | null
  contact_email: string | null; contact_phone: string | null; website: string | null; instagram: string | null
  notes: string | null; logo_url: string | null; created_at: string
}

const EMPTY = { name: '', category: '', contact_name: '', contact_email: '', contact_phone: '', website: '', instagram: '', notes: '' }
const STATUS = {
  pending_approval: { label: 'Pendiente de aprobación', color: 'bg-amber-50 text-amber-700' },
  approved: { label: 'Aprobada', color: 'bg-emerald-50 text-emerald-700' },
  rejected: { label: 'Rechazada', color: 'bg-red-50 text-red-600' },
}

export default function InfluencerBrandsPage() {
  const [brands, setBrands] = useState<OwnedBrand[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<OwnedBrand | null | undefined>(undefined)
  const [form, setForm] = useState(EMPTY)
  const [logo, setLogo] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/influencer/owned-brands')
      const json = await response.json()
      if (!response.ok) throw new Error(json.error)
      setBrands(json.data ?? [])
    } catch (error) { toast.error((error as Error).message || 'No se pudieron cargar tus marcas') }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  function openCreate() { setEditing(null); setForm(EMPTY); setLogo(null) }
  function openEdit(brand: OwnedBrand) {
    setEditing(brand); setLogo(null)
    setForm({ name: brand.name, category: brand.industry ?? '', contact_name: brand.contact_name ?? '', contact_email: brand.contact_email ?? '', contact_phone: brand.contact_phone ?? '', website: brand.website ?? '', instagram: brand.instagram ?? '', notes: brand.notes ?? '' })
  }
  function close() { setEditing(undefined); setLogo(null) }

  async function save() {
    if (!form.name.trim()) return toast.error('Ingresa el nombre de la marca')
    if (!form.contact_name.trim()) return toast.error('Ingresa el nombre del contacto')
    if (!form.contact_email.trim()) return toast.error('Ingresa el email del contacto')
    setSaving(true)
    try {
      const body = new FormData()
      Object.entries(form).forEach(([key, value]) => body.set(key, value))
      if (logo) body.set('logo', logo)
      const response = await fetch(editing ? `/api/influencer/owned-brands/${editing.id}` : '/api/influencer/owned-brands', { method: editing ? 'PATCH' : 'POST', body })
      const json = await response.json()
      if (!response.ok) throw new Error(json.error)
      setBrands(current => editing ? current.map(item => item.id === editing.id ? json.data : item) : [json.data, ...current])
      toast.success(editing ? 'Marca actualizada' : 'Marca agregada')
      close()
    } catch (error) { toast.error((error as Error).message || 'No se pudo guardar') }
    setSaving(false)
  }

  async function remove(brand: OwnedBrand) {
    if (!confirm(`¿Eliminar ${brand.name}?`)) return
    const response = await fetch(`/api/influencer/owned-brands/${brand.id}`, { method: 'DELETE' })
    if (response.ok) { setBrands(current => current.filter(item => item.id !== brand.id)); toast.success('Marca eliminada') }
    else toast.error((await response.json()).error || 'No se pudo eliminar')
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div><h1 className="text-2xl font-bold text-gray-900">Mis marcas</h1><p className="text-sm text-gray-400 mt-1">Tu directorio privado de contactos y colaboraciones</p></div>
        <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700"><Plus className="h-4 w-4" />Agregar marca</button>
      </div>

      {loading ? <div className="flex justify-center py-24"><Loader2 className="h-7 w-7 animate-spin text-violet-500" /></div> : brands.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white py-20 text-center"><Building2 className="mx-auto h-11 w-11 text-gray-200" /><h2 className="mt-4 font-semibold text-gray-700">Todavía no tienes marcas guardadas</h2><p className="mt-1 text-sm text-gray-400">Agrega contactos propios y registra tus colaboraciones.</p><button onClick={openCreate} className="mt-5 text-sm font-semibold text-violet-600">Agregar mi primera marca</button></div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{brands.map(brand => (
          <article key={brand.id} className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 flex-none items-center justify-center overflow-hidden rounded-xl bg-violet-50">{brand.logo_url ? <Image src={brand.logo_url} alt={`Logo ${brand.name}`} width={48} height={48} unoptimized className="h-full w-full object-cover" /> : <Building2 className="h-6 w-6 text-violet-400" />}</div>
              <div className="min-w-0 flex-1"><h2 className="truncate font-bold text-gray-900">{brand.name}</h2><p className="truncate text-xs text-gray-400">{brand.industry || 'Sin categoría'}</p><span className={cn('mt-2 inline-block rounded-full px-2 py-1 text-[11px] font-bold', STATUS[brand.status].color)}>{STATUS[brand.status].label}</span></div>
              {brand.status === 'pending_approval' && <div className="flex"><button onClick={() => openEdit(brand)} className="p-1.5 text-gray-400 hover:text-violet-600" title="Editar"><Pencil className="h-4 w-4" /></button><button onClick={() => remove(brand)} className="p-1.5 text-gray-400 hover:text-red-500" title="Eliminar"><Trash2 className="h-4 w-4" /></button></div>}
            </div>
            <div className="mt-4 space-y-2 border-t border-gray-50 pt-4 text-sm text-gray-600">
              {brand.contact_name && <p className="font-medium text-gray-700">{brand.contact_name}</p>}
              {brand.contact_email && <a className="flex items-center gap-2 hover:text-violet-600" href={`mailto:${brand.contact_email}`}><Mail className="h-3.5 w-3.5" />{brand.contact_email}</a>}
              {brand.contact_phone && <a className="flex items-center gap-2 hover:text-violet-600" href={`tel:${brand.contact_phone}`}><Phone className="h-3.5 w-3.5" />{brand.contact_phone}</a>}
              {brand.instagram && <a className="flex items-center gap-2 hover:text-violet-600" href={`https://instagram.com/${brand.instagram.replace(/^@/, '')}`} target="_blank" rel="noreferrer"><Instagram className="h-3.5 w-3.5" />{brand.instagram}</a>}
              {brand.website && <a className="flex items-center gap-2 hover:text-violet-600" href={brand.website.startsWith('http') ? brand.website : `https://${brand.website}`} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" />Sitio web</a>}
              {!brand.contact_name && !brand.contact_email && !brand.contact_phone && !brand.instagram && !brand.website && <p className="text-xs italic text-gray-400">Sin datos de contacto</p>}
            </div>
            {brand.notes && <p className="mt-4 line-clamp-3 rounded-xl bg-gray-50 p-3 text-xs leading-relaxed text-gray-500">{brand.notes}</p>}
          </article>
        ))}</div>
      )}

      {editing !== undefined && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
        <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-xl">
          <div className="sticky top-0 flex items-center justify-between border-b border-gray-100 bg-white px-6 py-4"><div><h2 className="font-bold text-gray-900">{editing ? 'Editar marca' : 'Agregar marca'}</h2><p className="text-xs text-gray-400">Esta información es privada</p></div><button onClick={close} className="p-2 text-gray-400"><X className="h-5 w-5" /></button></div>
          <div className="grid gap-4 p-6 sm:grid-cols-2">
            <Field label="Nombre *" value={form.name} onChange={value => setForm({ ...form, name: value })} />
            <Field label="Categoría" value={form.category} onChange={value => setForm({ ...form, category: value })} placeholder="Moda, belleza, tecnología..." />
            <label className="space-y-1.5 text-sm font-medium text-gray-700">Logo<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => setLogo(event.target.files?.[0] ?? null)} className="block w-full text-xs text-gray-500 file:mr-3 file:rounded-lg file:border-0 file:bg-violet-50 file:px-3 file:py-2 file:text-violet-700" /><span className="flex items-center gap-1 text-[11px] font-normal text-gray-400"><Upload className="h-3 w-3" />PNG, JPG o WebP · máximo 5 MB</span></label>
            <Field label="Nombre del contacto *" value={form.contact_name} onChange={value => setForm({ ...form, contact_name: value })} />
            <Field label="Email *" type="email" value={form.contact_email} onChange={value => setForm({ ...form, contact_email: value })} />
            <Field label="Teléfono" value={form.contact_phone} onChange={value => setForm({ ...form, contact_phone: value })} />
            <Field label="Instagram" value={form.instagram} onChange={value => setForm({ ...form, instagram: value })} placeholder="@marca" />
            <div className="sm:col-span-2"><Field label="Sitio web" value={form.website} onChange={value => setForm({ ...form, website: value })} placeholder="https://..." /></div>
            <label className="space-y-1.5 text-sm font-medium text-gray-700 sm:col-span-2">Notas<textarea value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })} rows={4} className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2.5 outline-none focus:border-violet-400" /></label>
          </div>
          <div className="sticky bottom-0 flex justify-end gap-3 border-t border-gray-100 bg-white px-6 py-4"><button onClick={close} className="rounded-xl px-4 py-2 text-sm font-semibold text-gray-500">Cancelar</button><button onClick={save} disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving && <Loader2 className="h-4 w-4 animate-spin" />}Guardar</button></div>
        </div>
      </div>}
    </div>
  )
}

function Field({ label, value, onChange, placeholder, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string }) {
  return <label className="block space-y-1.5 text-sm font-medium text-gray-700">{label}<input type={type} value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 outline-none focus:border-violet-400" /></label>
}
