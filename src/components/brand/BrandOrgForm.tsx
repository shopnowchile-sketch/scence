'use client'

/**
 * BrandOrgForm — Empresa + Contacto.
 * Usado en /brand-settings/organization.
 * Fetch propio de /api/brand/me, guarda solo campos de empresa/contacto.
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Building2, Save, Loader2, Globe, Instagram, Mail, Phone, User, AlertCircle, ImagePlus, Link2 } from 'lucide-react'
import { toast } from 'sonner'
import { COUNTRY_OPTIONS } from '@/lib/utils'
import { GooglePlacesAddress } from '@/components/brand/GooglePlacesAddress'
import { COMUNAS_CHILE } from '@/lib/communes-chile'

interface BrandProfile {
  name:          string | null
  logo_url:      string | null
  rut:           string | null
  industry:      string | null
  website:       string | null
  instagram:     string | null
  contact_name:  string | null
  contact_email: string | null
  contact_phone: string | null
  address_street: string | null
  address_number: string | null
  address_city: string | null
  address_region: string | null
  address_country: string | null
  address_place_id: string | null
  address_lat: number | null
  address_lng: number | null
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

export function BrandOrgForm() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const forcedComplete = searchParams.get('complete') === '1'
  const [form, setForm] = useState<BrandProfile>({} as BrandProfile)
  const [organizationId, setOrganizationId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [countryCode, setCountryCode] = useState('CL')
  const [addressSearch, setAddressSearch] = useState('')
  const logoInputRef = useRef<HTMLInputElement>(null)
  const [uploadingLogo, setUploadingLogo] = useState(false)

  const set = (k: keyof BrandProfile) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const load = useCallback(async () => {
    try {
      const res  = await fetch('/api/brand/me')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setOrganizationId(json.data.organization_id ?? '')
      setForm({
        name:          json.data.name          ?? '',
        logo_url:      json.data.logo_url      ?? '',
        rut:           json.data.rut           ?? '',
        industry:      json.data.industry      ?? '',
        website:       json.data.website       ?? '',
        instagram:     json.data.instagram     ?? '',
        contact_name:  json.data.contact_name  ?? '',
        contact_email: json.data.contact_email ?? '',
        contact_phone: json.data.contact_phone ?? '',
        address_street: json.data.address_street ?? '',
        address_number: json.data.address_number ?? '',
        address_city: json.data.address_city ?? '',
        address_region: json.data.address_region ?? '',
        address_country: json.data.address_country ?? 'Chile',
        address_place_id: json.data.address_place_id ?? '',
        address_lat: json.data.address_lat ?? null,
        address_lng: json.data.address_lng ?? null,
      })
      const country = COUNTRY_OPTIONS.find(c => c.label === (json.data.address_country ?? 'Chile'))
      setCountryCode(country?.code ?? 'CL')
      setAddressSearch([json.data.address_street, json.data.address_number, json.data.address_city, json.data.address_region, json.data.address_country].filter(Boolean).join(', '))
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function uploadLogo(file: File) {
    if (!file.type.startsWith('image/') || file.size > 5 * 1024 * 1024) { toast.error('Usa una imagen JPG, PNG o WebP de máximo 5 MB.'); return }
    setUploadingLogo(true)
    try {
      const data = new FormData(); data.append('file', file)
      const res = await fetch('/api/brand/logo', { method: 'POST', body: data })
      const json = await res.json(); if (!res.ok) throw new Error(json.error)
      setForm(current => ({ ...current, logo_url: json.logo_url }))
      toast.success('Logo actualizado')
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo subir el logo') } finally { setUploadingLogo(false) }
  }

  async function handleSave() {
    if (!form.rut?.trim() || !form.address_street?.trim() || !form.address_city?.trim() || !form.address_region?.trim() || !form.address_country?.trim()) {
      toast.error('Completa RUT y todos los datos de dirección legal')
      return
    }
    setSaving(true)
    try {
      const res  = await fetch('/api/brand/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Organización actualizada')
      // Si veníamos del gate obligatorio (?complete=1) y ya quedó el
      // Instagram completo, limpiar el query param para que el aviso no
      // quede pegado en pantalla (el layout revalida el bloqueo aparte).
      if (forcedComplete && form.instagram && String(form.instagram).trim()) {
        router.replace('/brand-settings/organization')
      }
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

  const missingInstagram = !form.instagram || !String(form.instagram).trim()
  const instagramConnection = searchParams.get('instagram')
  const localityLabel = countryCode === 'CL' ? 'Comuna *' : 'Ciudad / localidad *'
  const regionLabel = countryCode === 'CL' ? 'Región *' : 'Región / estado *'

  return (
    <div className="space-y-5">

      {(forcedComplete || missingInstagram) && (
        <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          Para usar el portal necesitas completar el Instagram de tu marca.
        </div>
      )}

      {instagramConnection === 'connected' && <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">Instagram conectado. Actualizamos el @usuario y la foto de perfil de tu marca.</div>}
      {instagramConnection === 'error' && <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">No pudimos conectar Instagram. Inténtalo nuevamente.</div>}
      {instagramConnection === 'unavailable' && <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">La conexión de Instagram está siendo configurada por SCENCE.</div>}

      {/* Empresa */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
        <SectionTitle icon={Building2} label="Empresa" />
        <div className="flex items-center gap-4 pb-1">
          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-500 text-white flex items-center justify-center text-xl font-bold">
            {form.logo_url ? <img src={form.logo_url} alt="Logo de la marca" className="h-full w-full object-cover" /> : (form.name?.trim().charAt(0).toUpperCase() || 'M')}
          </div>
          <div><input ref={logoInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={event => { const file = event.target.files?.[0]; if (file) void uploadLogo(file); event.currentTarget.value = '' }} />
            <button type="button" disabled={uploadingLogo} onClick={() => logoInputRef.current?.click()} className="inline-flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-semibold text-violet-700 disabled:opacity-60"><ImagePlus className="h-4 w-4" />{uploadingLogo ? 'Subiendo logo…' : form.logo_url ? 'Cambiar logo' : 'Subir logo'}</button>
            <p className="mt-1.5 text-xs text-gray-400">JPG, PNG o WebP. Máximo 5 MB.</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Field label="Nombre de la empresa">
              <input value={form.name ?? ''} onChange={set('name')} placeholder="Nike LATAM" className="input-base w-full" />
            </Field>
          </div>
          <Field label="RUT *">
            <input value={form.rut ?? ''} onChange={set('rut')} placeholder="76.123.456-7" required className="input-base w-full" />
          </Field>
          <Field label="Organization ID">
            <input
              value={organizationId}
              readOnly
              className="input-base w-full bg-gray-50 text-gray-500 font-mono text-xs"
            />
          </Field>
          <Field label="Industria / Rubro">
            <input value={form.industry ?? ''} onChange={set('industry')} placeholder="Moda, Belleza…" className="input-base w-full" />
          </Field>
          <Field label="Sitio web">
            <div className="flex items-center gap-1">
              <Globe className="h-3.5 w-3.5 text-gray-300 flex-shrink-0" />
              <input type="url" value={form.website ?? ''} onChange={set('website')} placeholder="https://empresa.com" className="input-base w-full" />
            </div>
          </Field>
          <Field label="Instagram *">
            <div className="flex items-center gap-1">
              <Instagram className="h-3.5 w-3.5 text-gray-300 flex-shrink-0" />
              <input value={form.instagram ?? ''} onChange={set('instagram')} placeholder="@miempresa" required className="input-base w-full" />
            </div>
          </Field>
          <div className="col-span-2 -mt-1 flex items-center justify-between rounded-xl border border-violet-100 bg-violet-50/60 px-3 py-2.5">
            <p className="text-xs text-violet-800">Conecta tu cuenta profesional para usar automáticamente su foto y @usuario.</p>
            <button type="button" onClick={() => { window.location.assign('/api/brand/instagram/connect') }} className="ml-3 inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-xs font-semibold text-violet-700 shadow-sm ring-1 ring-violet-200 hover:bg-violet-100"><Link2 className="h-3.5 w-3.5" />Conectar</button>
          </div>
          <div className="col-span-2 pt-2 border-t border-gray-100">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Dirección legal *</p>
            <p className="text-xs text-gray-400 mt-1">Puedes buscar con Google Maps cuando esté configurado o completar los datos manualmente.</p>
          </div>
          <Field label="País *">
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
            <Field label="Buscar dirección en Google Maps *">
              <GooglePlacesAddress countryCode={countryCode} value={addressSearch} onChange={setAddressSearch} onSelect={address => {
                setCountryCode(address.countryCode)
                setForm(f => ({ ...f, address_street: address.street, address_number: address.number, address_city: address.commune, address_region: address.region, address_country: address.country, address_place_id: address.placeId, address_lat: address.lat, address_lng: address.lng }))
              }} />
            </Field>
          </div>
          <Field label="Calle *">
            <input value={form.address_street ?? ''} onChange={set('address_street')} placeholder="Av. Providencia" required className="input-base w-full" />
          </Field>
          <Field label="Número">
            <input value={form.address_number ?? ''} onChange={set('address_number')} placeholder="1234" className="input-base w-full" />
          </Field>
          <Field label={localityLabel}>
            <><input value={form.address_city ?? ''} onChange={set('address_city')} placeholder={countryCode === 'CL' ? 'Providencia' : 'Ciudad'} list={countryCode === 'CL' ? 'brand-communes' : undefined} required className="input-base w-full" />{countryCode === 'CL' && <datalist id="brand-communes">{COMUNAS_CHILE.map(commune => <option key={commune} value={commune} />)}</datalist>}</>
          </Field>
          <Field label={regionLabel}>
            <input value={form.address_region ?? ''} onChange={set('address_region')} placeholder={countryCode === 'CL' ? 'Región Metropolitana' : 'Estado / región'} required className="input-base w-full" />
          </Field>
        </div>
      </div>

      {/* Contacto */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
        <SectionTitle icon={User} label="Contacto" />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nombre">
            <input value={form.contact_name ?? ''} onChange={set('contact_name')} placeholder="Ana García" className="input-base w-full" />
          </Field>
          <Field label="Email">
            <div className="flex items-center gap-1">
              <Mail className="h-3.5 w-3.5 text-gray-300 flex-shrink-0" />
              <input type="email" value={form.contact_email ?? ''} onChange={set('contact_email')} placeholder="ana@empresa.com" className="input-base w-full" />
            </div>
          </Field>
          <Field label="Teléfono">
            <div className="flex items-center gap-1">
              <Phone className="h-3.5 w-3.5 text-gray-300 flex-shrink-0" />
              <input type="tel" value={form.contact_phone ?? ''} onChange={set('contact_phone')} placeholder="+56 9 XXXX XXXX" className="input-base w-full" />
            </div>
          </Field>
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full flex items-center justify-center gap-2 py-2.5 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700 disabled:opacity-60 transition-colors"
      >
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
        {saving ? 'Guardando…' : 'Guardar cambios'}
      </button>
    </div>
  )
}
