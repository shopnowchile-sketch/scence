'use client'

/**
 * BrandOrgForm — Empresa + Contacto.
 * Usado en /brand-settings/organization.
 * Fetch propio de /api/brand/me, guarda solo campos de empresa/contacto.
 */

import { useEffect, useState, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Building2, Save, Loader2, Globe, Instagram, Mail, Phone, User, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'

interface BrandProfile {
  name:          string | null
  rut:           string | null
  industry:      string | null
  website:       string | null
  instagram:     string | null
  contact_name:  string | null
  contact_email: string | null
  contact_phone: string | null
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
  const [form,   setForm]   = useState<BrandProfile>({} as BrandProfile)
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)

  const set = (k: keyof BrandProfile) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const load = useCallback(async () => {
    try {
      const res  = await fetch('/api/brand/me')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setForm({
        name:          json.data.name          ?? '',
        rut:           json.data.rut           ?? '',
        industry:      json.data.industry      ?? '',
        website:       json.data.website       ?? '',
        instagram:     json.data.instagram     ?? '',
        contact_name:  json.data.contact_name  ?? '',
        contact_email: json.data.contact_email ?? '',
        contact_phone: json.data.contact_phone ?? '',
      })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleSave() {
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

  return (
    <div className="space-y-5">

      {(forcedComplete || missingInstagram) && (
        <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          Para usar el portal necesitas completar el Instagram de tu marca.
        </div>
      )}

      {/* Empresa */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
        <SectionTitle icon={Building2} label="Empresa" />
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Field label="Nombre de la empresa">
              <input value={form.name ?? ''} onChange={set('name')} placeholder="Nike LATAM" className="input-base w-full" />
            </Field>
          </div>
          <Field label="RUT">
            <input value={form.rut ?? ''} onChange={set('rut')} placeholder="76.123.456-7" className="input-base w-full" />
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
