'use client'

/**
 * BrandAddressForm — Dirección principal y secundaria de la marca.
 * Usado en /brand-settings/locations.
 * Fetch propio de /api/brand/me, guarda solo campos de dirección.
 */

import { useEffect, useState, useCallback } from 'react'
import { MapPin, Save, Loader2, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface AddressFields {
  address_street:  string | null
  address_number:  string | null
  address_city:    string | null
  address_region:  string | null
  address_country: string | null
  address2_street:  string | null
  address2_number:  string | null
  address2_city:    string | null
  address2_region:  string | null
  address2_country: string | null
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-gray-400 mb-1">{label}</label>
      {children}
    </div>
  )
}

function SectionTitle({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
      <Icon className="h-3 w-3" /> {label}
    </p>
  )
}

const REGIONS_CL = [
  'Región Metropolitana', 'Valparaíso', 'Biobío', 'La Araucanía', 'Los Lagos',
  'Maule', 'O\'Higgins', 'Coquimbo', 'Los Ríos', 'Antofagasta', 'Tarapacá',
  'Atacama', 'Arica y Parinacota', 'Aysén', 'Magallanes', 'Ñuble',
]

export function BrandAddressForm() {
  const [form,    setForm]    = useState<AddressFields>({} as AddressFields)
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [hasAddr2, setHasAddr2] = useState(false)

  const set = (k: keyof AddressFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const load = useCallback(async () => {
    try {
      const res  = await fetch('/api/brand/me')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      const d = json.data
      setForm({
        address_street:  d.address_street  ?? '',
        address_number:  d.address_number  ?? '',
        address_city:    d.address_city    ?? '',
        address_region:  d.address_region  ?? '',
        address_country: d.address_country ?? 'Chile',
        address2_street:  d.address2_street  ?? '',
        address2_number:  d.address2_number  ?? '',
        address2_city:    d.address2_city    ?? '',
        address2_region:  d.address2_region  ?? '',
        address2_country: d.address2_country ?? 'Chile',
      })
      setHasAddr2(!!d.address2_street)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleSave() {
    setSaving(true)
    const payload = { ...form }
    if (!hasAddr2) {
      payload.address2_street  = null
      payload.address2_number  = null
      payload.address2_city    = null
      payload.address2_region  = null
      payload.address2_country = null
    }
    try {
      const res  = await fetch('/api/brand/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Direcciones actualizadas')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center min-h-[30vh]">
      <Loader2 className="h-6 w-6 animate-spin text-violet-400" />
    </div>
  )

  return (
    <div className="space-y-5">

      {/* Dirección principal */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
        <SectionTitle icon={MapPin} label="Dirección principal" />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Calle">
            <input value={form.address_street ?? ''} onChange={set('address_street')} placeholder="Av. Providencia" className="input-base w-full" />
          </Field>
          <Field label="Número">
            <input value={form.address_number ?? ''} onChange={set('address_number')} placeholder="1234" className="input-base w-full" />
          </Field>
          <Field label="Ciudad">
            <input value={form.address_city ?? ''} onChange={set('address_city')} placeholder="Santiago" className="input-base w-full" />
          </Field>
          <Field label="Región">
            <select value={form.address_region ?? ''} onChange={set('address_region')} className="input-base w-full">
              <option value="">Seleccionar región</option>
              {REGIONS_CL.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="País">
            <input value={form.address_country ?? 'Chile'} onChange={set('address_country')} placeholder="Chile" className="input-base w-full" />
          </Field>
        </div>

        {/* Checkbox dirección secundaria */}
        <label className="flex items-center gap-2 cursor-pointer mt-1">
          <input
            type="checkbox"
            checked={hasAddr2}
            onChange={e => setHasAddr2(e.target.checked)}
            className="w-4 h-4 accent-violet-600"
          />
          <span className="text-sm text-gray-600">Agregar dirección secundaria</span>
          <ChevronDown className={cn('h-3.5 w-3.5 text-gray-400 transition-transform', hasAddr2 && 'rotate-180')} />
        </label>

        {hasAddr2 && (
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-gray-50">
            <p className="col-span-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Dirección secundaria</p>
            <Field label="Calle">
              <input value={form.address2_street ?? ''} onChange={set('address2_street')} placeholder="Av. Apoquindo" className="input-base w-full" />
            </Field>
            <Field label="Número">
              <input value={form.address2_number ?? ''} onChange={set('address2_number')} placeholder="4500" className="input-base w-full" />
            </Field>
            <Field label="Ciudad">
              <input value={form.address2_city ?? ''} onChange={set('address2_city')} placeholder="Las Condes" className="input-base w-full" />
            </Field>
            <Field label="Región">
              <select value={form.address2_region ?? ''} onChange={set('address2_region')} className="input-base w-full">
                <option value="">Seleccionar región</option>
                {REGIONS_CL.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
            <Field label="País">
              <input value={form.address2_country ?? 'Chile'} onChange={set('address2_country')} placeholder="Chile" className="input-base w-full" />
            </Field>
          </div>
        )}
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full flex items-center justify-center gap-2 py-2.5 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700 disabled:opacity-60 transition-colors"
      >
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
        {saving ? 'Guardando…' : 'Guardar direcciones'}
      </button>
    </div>
  )
}
