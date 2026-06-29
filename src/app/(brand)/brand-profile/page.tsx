'use client'

import { useEffect, useState, useCallback } from 'react'
import { Building2, Save, Loader2, MapPin, Phone, Mail, User, Globe, Instagram, Hash, Users, Plus, Trash2, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

// ── Types ────────────────────────────────────────────────────────────────────

interface BrandProfile {
  id: string
  name: string
  logo_url: string | null
  website: string | null
  instagram: string | null
  industry: string | null
  rut: string | null
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  address_street: string | null
  address_number: string | null
  address_city: string | null
  address_region: string | null
  address_country: string | null
  address2_street: string | null
  address2_number: string | null
  address2_city: string | null
  address2_region: string | null
  address2_country: string | null
}

interface BrandMember {
  id: string
  email: string
  role: 'owner' | 'editor' | 'viewer'
  invited_at: string
  joined_at: string | null
  is_active: boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function Field({ label, col2, children }: { label: string; col2?: boolean; children: React.ReactNode }) {
  return (
    <div className={col2 ? 'col-span-2' : ''}>
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

// ── Main ──────────────────────────────────────────────────────────────────────

export default function BrandProfilePage() {
  const [profile,   setProfile]   = useState<BrandProfile | null>(null)
  const [members,   setMembers]   = useState<BrandMember[]>([])
  const [loading,   setLoading]   = useState(true)
  const [saving,    setSaving]    = useState(false)
  const [form,      setForm]      = useState<Partial<BrandProfile>>({})
  const [hasAddr2,  setHasAddr2]  = useState(false)
  const [newEmail,  setNewEmail]  = useState('')
  const [newRole,   setNewRole]   = useState<'editor' | 'viewer'>('editor')
  const [inviting,  setInviting]  = useState(false)

  const set = (k: keyof BrandProfile) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const load = useCallback(async () => {
    try {
      const [profileRes, membersRes] = await Promise.all([
        fetch('/api/brand/me'),
        fetch('/api/brand/members'),
      ])
      const [pJson, mJson] = await Promise.all([profileRes.json(), membersRes.json()])
      if (!profileRes.ok) throw new Error(pJson.error)
      setProfile(pJson.data)
      setForm(pJson.data)
      setHasAddr2(!!pJson.data?.address2_street)
      if (membersRes.ok) setMembers(mJson.data ?? [])
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
      const payload = { ...form }
      if (!hasAddr2) {
        payload.address2_street = null
        payload.address2_number = null
        payload.address2_city = null
        payload.address2_region = null
        payload.address2_country = null
      }
      const res  = await fetch('/api/brand/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setProfile(json.data)
      toast.success('Perfil actualizado')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function handleInvite() {
    if (!newEmail) return
    setInviting(true)
    try {
      const res  = await fetch('/api/brand/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail, role: newRole }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setMembers(prev => [json.data, ...prev])
      setNewEmail('')
      toast.success('Invitación enviada')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setInviting(false)
    }
  }

  async function handleRemove(id: string) {
    if (!confirm('¿Desactivar el acceso de este usuario?')) return
    const res = await fetch(`/api/brand/members?id=${id}`, { method: 'DELETE' })
    if (res.ok) {
      setMembers(prev => prev.map(m => m.id === id ? { ...m, is_active: false } : m))
      toast.success('Acceso desactivado')
    } else {
      toast.error('Error al desactivar')
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <Loader2 className="h-6 w-6 animate-spin text-violet-400" />
    </div>
  )

  const initials = profile?.name?.slice(0, 2).toUpperCase() ?? '??'

  return (
    <div className="max-w-2xl mx-auto space-y-5 py-2">

      {/* Header */}
      <div className="flex items-center gap-3">
        {profile?.logo_url
          ? <img src={profile.logo_url} alt={profile.name} className="w-10 h-10 rounded-xl object-contain border border-gray-100" />
          : <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center text-sm font-bold text-violet-600 flex-shrink-0">{initials}</div>
        }
        <div>
          <h1 className="text-lg font-bold text-gray-900">{profile?.name}</h1>
          {profile?.industry && <p className="text-xs text-gray-400">{profile.industry}</p>}
        </div>
      </div>

      {/* ── Sección Empresa ─────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
        <SectionTitle icon={Building2} label="Empresa" />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nombre de la empresa" col2>
            <input value={form.name ?? ''} onChange={set('name')} placeholder="Nike LATAM" className="input-base w-full" />
          </Field>
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
          <Field label="Instagram">
            <div className="flex items-center gap-1">
              <Instagram className="h-3.5 w-3.5 text-gray-300 flex-shrink-0" />
              <input value={form.instagram ?? ''} onChange={set('instagram')} placeholder="@miempresa" className="input-base w-full" />
            </div>
          </Field>
        </div>
      </div>

      {/* ── Dirección Principal ──────────────────────────────────────────────── */}
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

      {/* ── Contacto ────────────────────────────────────────────────────────── */}
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

      {/* Guardar */}
      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full flex items-center justify-center gap-2 py-2.5 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700 disabled:opacity-60 transition-colors"
      >
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
        {saving ? 'Guardando…' : 'Guardar cambios'}
      </button>

      {/* ── Usuarios del portal ──────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
        <SectionTitle icon={Users} label="Usuarios con acceso" />
        <p className="text-xs text-gray-400">Invita a tu equipo a acceder al portal de tu marca.</p>

        {/* Invitar nuevo */}
        <div className="flex gap-2">
          <input
            type="email"
            value={newEmail}
            onChange={e => setNewEmail(e.target.value)}
            placeholder="email@equipo.com"
            className="input-base flex-1"
            onKeyDown={e => e.key === 'Enter' && handleInvite()}
          />
          <select
            value={newRole}
            onChange={e => setNewRole(e.target.value as 'editor' | 'viewer')}
            className="input-base w-28"
          >
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
          <button
            onClick={handleInvite}
            disabled={inviting || !newEmail}
            className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700 disabled:opacity-60 transition-colors flex-shrink-0"
          >
            {inviting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Invitar
          </button>
        </div>

        {/* Lista de miembros */}
        {members.length === 0 ? (
          <p className="text-xs text-gray-300 text-center py-4">Sin usuarios adicionales aún.</p>
        ) : (
          <div className="space-y-2">
            {members.map(m => (
              <div key={m.id} className={cn('flex items-center gap-3 px-3 py-2.5 rounded-xl border', m.is_active ? 'border-gray-100 bg-gray-50/50' : 'border-gray-100 bg-gray-50 opacity-50')}>
                <div className="w-7 h-7 rounded-full bg-violet-100 flex items-center justify-center text-[10px] font-bold text-violet-600 flex-shrink-0">
                  {m.email[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{m.email}</p>
                  <p className="text-[10px] text-gray-400">
                    {m.joined_at ? '✓ Activo' : '⏳ Invitación pendiente'} · {m.role}
                  </p>
                </div>
                {m.is_active && m.role !== 'owner' && (
                  <button
                    onClick={() => handleRemove(m.id)}
                    className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-500 transition-colors"
                    title="Desactivar acceso"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
                {!m.is_active && <span className="text-[10px] text-gray-400 font-medium">Desactivado</span>}
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  )
}
