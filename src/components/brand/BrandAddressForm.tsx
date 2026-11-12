'use client'

/**
 * BrandAddressForm — Dirección principal de la marca (la secundaria solo se muestra si ya existe).
 * Usado en /brand-settings/locations.
 * Fetch propio de /api/brand/me, guarda solo campos de dirección.
 */

import { useEffect, useState, useCallback } from 'react'
import { MapPin, Save, Loader2, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { cn, COUNTRY_OPTIONS } from '@/lib/utils'
import { GooglePlacesAddress } from '@/components/brand/GooglePlacesAddress'
import { COMUNAS_CHILE } from '@/lib/communes-chile'

interface AddressFields {
  address_street:  string | null
  address_number:  string | null
  address_city:    string | null
  address_region:  string | null
  address_country: string | null
  address_place_id: string | null
  address_lat: number | null
  address_lng: number | null
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
  // La dirección secundaria no se usa (0 de 79 marcas): solo se muestra si la marca ya tiene una guardada.
  const [showAddr2, setShowAddr2] = useState(false)
  const [countryCode, setCountryCode] = useState('CL')
  const [addressSearch, setAddressSearch] = useState('')

  const set = (k: keyof AddressFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))
  // Editar a mano la dirección principal invalida su lugar y coordenadas: hay que volver a elegirla en el buscador.
  const setPrimary = (k: keyof AddressFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value, address_place_id: '', address_lat: null, address_lng: null }))

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
        address_place_id: d.address_place_id ?? '',
        address_lat:      d.address_lat ?? null,
        address_lng:      d.address_lng ?? null,
        address2_street:  d.address2_street  ?? '',
        address2_number:  d.address2_number  ?? '',
        address2_city:    d.address2_city    ?? '',
        address2_region:  d.address2_region  ?? '',
        address2_country: d.address2_country ?? 'Chile',
      })
      setCountryCode(COUNTRY_OPTIONS.find(c => c.label === (d.address_country ?? 'Chile'))?.code ?? 'CL')
      setHasAddr2(!!d.address2_street)
      setShowAddr2(!!d.address2_street)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleSave() {
    setSaving(true)
    const payload: Partial<AddressFields> = { ...form }
    if (!showAddr2) {
      // Oculta y sin datos: no se envía nada de la secundaria.
      delete payload.address2_street; delete payload.address2_number; delete payload.address2_city
      delete payload.address2_region; delete payload.address2_country
    } else if (!hasAddr2) {
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
          <Field label="País">
            <select value={countryCode} onChange={e => {
              const selected = COUNTRY_OPTIONS.find(c => c.code === e.target.value)
              setCountryCode(e.target.value)
              setAddressSearch('')
              setForm(f => ({ ...f, address_country: selected?.label ?? '', address_place_id: '', address_lat: null, address_lng: null, address_street: '', address_number: '', address_city: '', address_region: '' }))
            }} className="input-base w-full">
              {COUNTRY_OPTIONS.map(country => <option key={country.code} value={country.code}>{country.label}</option>)}
            </select>
          </Field>
          <div className="col-span-2">
            <Field label="Buscar dirección en Google Maps">
              <GooglePlacesAddress countryCode={countryCode} value={addressSearch} onChange={setAddressSearch} onSelect={address => {
                setCountryCode(address.countryCode)
                setForm(f => ({ ...f, address_street: address.street, address_number: address.number, address_city: address.commune, address_region: address.region, address_country: address.country, address_place_id: address.placeId, address_lat: address.lat, address_lng: address.lng }))
              }} />
            </Field>
            {!form.address_place_id && <p className="mt-1 text-[11px] text-amber-600">Elige la dirección en el buscador para guardar también su ubicación en el mapa.</p>}
          </div>
          <Field label="Calle">
            <input value={form.address_street ?? ''} onChange={setPrimary('address_street')} placeholder="Av. Providencia" className="input-base w-full" />
          </Field>
          <Field label="Número">
            <input value={form.address_number ?? ''} onChange={setPrimary('address_number')} placeholder="1234" className="input-base w-full" />
          </Field>
          <Field label={countryCode === 'CL' ? 'Comuna' : 'Ciudad / localidad'}>
            <><input value={form.address_city ?? ''} onChange={setPrimary('address_city')} placeholder={countryCode === 'CL' ? 'Providencia' : 'Ciudad'} list={countryCode === 'CL' ? 'brand-communes' : undefined} className="input-base w-full" />{countryCode === 'CL' && <datalist id="brand-communes">{COMUNAS_CHILE.map(commune => <option key={commune} value={commune} />)}</datalist>}</>
          </Field>
          <Field label={countryCode === 'CL' ? 'Región' : 'Región / estado'}>
            <input value={form.address_region ?? ''} onChange={setPrimary('address_region')} placeholder={countryCode === 'CL' ? 'Región Metropolitana' : 'Estado / región'} className="input-base w-full" />
          </Field>
        </div>

        {/* Checkbox dirección secundaria (solo si la marca ya tiene una) */}
        {showAddr2 && <label className="flex items-center gap-2 cursor-pointer mt-1">
          <input
            type="checkbox"
            checked={hasAddr2}
            onChange={e => setHasAddr2(e.target.checked)}
            className="w-4 h-4 accent-violet-600"
          />
          <span className="text-sm text-gray-600">Agregar dirección secundaria</span>
          <ChevronDown className={cn('h-3.5 w-3.5 text-gray-400 transition-transform', hasAddr2 && 'rotate-180')} />
        </label>}

        {showAddr2 && hasAddr2 && (
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
