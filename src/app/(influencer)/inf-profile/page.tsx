'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import {
  AlertCircle, RefreshCw, Edit2, Save, X, Plus, Trash2,
  Target, Zap, Banknote, MapPin, Tag, Share2, Mail, User,
  Phone, Globe, Calendar, Camera, ImagePlus,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import NotificationPreferencesForm from '@/components/settings/NotificationPreferencesForm'

type SocialProfile = {
  id?: string
  platform: string
  username: string
  followers: number
  engagement_rate: number | null
  profile_url: string | null
  _delete?: boolean
}

type InfluencerProfile = {
  id: string
  display_name: string
  email: string | null
  bio: string | null
  avatar_url: string | null
  phone: string | null
  city: string | null
  country: string | null
  address: string | null
  commune: string | null
  birth_date: string | null
  categories: string[] | null
  influencer_social_profiles: SocialProfile[] | null
  referred_brands_count?: number
}

// Perfil obligatorio: nombre + Instagram + comuna + dirección. Se usa para forzar la
// edición al entrar al portal si falta alguno (ver useEffect más abajo).
// NOTA (2026-07-04): fecha de nacimiento es obligatoria SOLO al guardar
// (ver findMissingRequired) — no se agregó acá para no bloquear de golpe la
// navegación de las 1432 cuentas ya activas que no la tienen (decisión Pri).
function isProfileComplete(p: InfluencerProfile) {
  const hasName      = !!(p.display_name && p.display_name.trim())
  const hasAddress   = !!(p.address && p.address.trim())
  const hasCommune   = !!(p.commune && p.commune.trim())
  const hasInstagram = (p.influencer_social_profiles ?? []).some(
    sp => sp.platform === 'instagram' && sp.username && sp.username.trim()
  )
  return hasName && hasAddress && hasCommune && hasInstagram
}

type Deliverable = { id: string; status: string }
type Campaign = {
  id: string
  campaign: { status: string } | null
  campaign_deliverables?: Deliverable[] | null
}
type Payment  = { id: string; net_amount: number; currency: string }

const PLATFORMS = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'tiktok',    label: 'TikTok' },
  { value: 'youtube',   label: 'YouTube' },
  { value: 'twitter',   label: 'Twitter / X' },
  { value: 'facebook',  label: 'Facebook' },
  { value: 'linkedin',  label: 'LinkedIn' },
  { value: 'pinterest', label: 'Pinterest' },
  { value: 'twitch',    label: 'Twitch' },
  { value: 'snapchat',  label: 'Snapchat' },
  { value: 'threads',   label: 'Threads' },
]

const PLATFORM_COLORS: Record<string, string> = {
  instagram: 'from-pink-500 to-orange-400',
  tiktok:    'from-gray-800 to-gray-600',
  youtube:   'from-red-600 to-red-400',
  twitter:   'from-sky-500 to-blue-400',
  facebook:  'from-blue-700 to-blue-500',
  linkedin:  'from-blue-800 to-blue-600',
  pinterest: 'from-red-700 to-red-500',
  twitch:    'from-purple-700 to-purple-500',
  snapchat:  'from-yellow-400 to-yellow-300',
  threads:   'from-gray-900 to-gray-700',
}

function fmtMoney(n: number, currency: string) {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency, minimumFractionDigits: 0 }).format(n)
}

function Field({ label, value, onChange, type = 'text', placeholder = '', textarea = false }: {
  label: string; value: string; onChange: (v: string) => void
  type?: string; placeholder?: string; textarea?: boolean
}) {
  const base = 'w-full text-sm border border-gray-200 rounded-xl px-3 py-2 outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-100 transition-colors bg-gray-50 focus:bg-white'
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-500 mb-1.5">{label}</label>
      {textarea ? (
        <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={3} className={cn(base, 'resize-none')} />
      ) : (
        <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={base} />
      )}
    </div>
  )
}

export default function ProfilePage() {
  const [profile,   setProfile]   = useState<InfluencerProfile | null>(null)
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [payments,  setPayments]  = useState<{ pending: Payment[]; completed: Payment[] }>({ pending: [], completed: [] })
  const [loading,   setLoading]   = useState(true)
  const [editing,   setEditing]   = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [editForm,  setEditForm]  = useState({ display_name: '', bio: '', phone: '', city: '', country: '', address: '', commune: '', birth_date: '', categories: '' })
  const [socials,   setSocials]   = useState<SocialProfile[]>([])
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [meRes, campRes, payRes] = await Promise.all([
        fetch('/api/influencer/me'),
        fetch('/api/influencer/campaigns'),
        fetch('/api/influencer/payments'),
      ])
      if (!meRes.ok) { toast.error('Error cargando perfil'); setLoading(false); return }
      const [meData, campData, payData] = await Promise.all([meRes.json(), campRes.json(), payRes.json()])
      setProfile(meData.data)
      setCampaigns(campData.data ?? [])
      setPayments({ pending: payData.pending ?? [], completed: payData.completed ?? [] })
    } catch { toast.error('Error cargando perfil') }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Perfil obligatorio: si falta Instagram, comuna o dirección, se fuerza el
  // modo edición al entrar (no se puede navegar el portal con el perfil
  // incompleto — ver ProfileCompletionGate en el layout, que ya redirige acá).
  useEffect(() => {
    if (profile && !isProfileComplete(profile) && !editing) startEdit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile])

  function startEdit() {
    if (!profile) return
    setEditForm({
      display_name: profile.display_name ?? '',
      bio: profile.bio ?? '',
      phone: profile.phone ?? '',
      city: profile.city ?? '',
      country: profile.country ?? '',
      address: profile.address ?? '',
      commune: profile.commune ?? '',
      birth_date: profile.birth_date ?? '',
      categories: (profile.categories ?? []).join(', '),
    })
    const existingSocials = (profile.influencer_social_profiles ?? []).map(sp => ({ ...sp }))
    if (!existingSocials.some(sp => sp.platform === 'instagram')) {
      existingSocials.unshift({ platform: 'instagram', username: '', followers: 0, engagement_rate: null, profile_url: null })
    }
    setSocials(existingSocials)
    setEditing(true)
  }

  function findMissingRequired(): string[] {
    const missing: string[] = []
    if (!editForm.display_name.trim()) missing.push('Nombre')
    if (!editForm.address.trim()) missing.push('Dirección')
    if (!editForm.commune.trim()) missing.push('Comuna')
    if (!editForm.birth_date.trim()) missing.push('Fecha de nacimiento')
    const hasInstagram = socials.some(s => !s._delete && s.platform === 'instagram' && s.username.trim())
    if (!hasInstagram) missing.push('Instagram (usuario)')
    return missing
  }

  async function saveProfile() {
    const missing = findMissingRequired()
    if (missing.length > 0) {
      toast.error(`Completa los campos obligatorios: ${missing.join(', ')}`)
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/influencer/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...editForm,
          categories: editForm.categories ? editForm.categories.split(',').map(s => s.trim()).filter(Boolean) : [],
          social_profiles: socials,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setProfile(json.data)
      setEditing(false)
      toast.success('Perfil actualizado')
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error al guardar')
    }
    setSaving(false)
  }

  function updateSocial(idx: number, key: keyof SocialProfile, val: unknown) {
    setSocials(prev => prev.map((s, i) => i === idx ? { ...s, [key]: val } : s))
  }

  async function uploadAvatar(file: File) {
    if (!file.type.startsWith('image/')) {
      toast.error('Elige una imagen JPG, PNG o WebP.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('La foto debe pesar menos de 5 MB.')
      return
    }

    const preview = URL.createObjectURL(file)
    setAvatarPreview(preview)
    setUploadingAvatar(true)
    try {
      const data = new FormData()
      data.append('file', file)
      const res = await fetch('/api/influencer/avatar', { method: 'POST', body: data })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setProfile(prev => prev ? { ...prev, avatar_url: json.avatar_url } : prev)
      setAvatarPreview(null)
      URL.revokeObjectURL(preview)
      toast.success('Foto de perfil actualizada')
    } catch (error) {
      setAvatarPreview(null)
      URL.revokeObjectURL(preview)
      toast.error(error instanceof Error ? error.message : 'No se pudo subir la foto')
    }
    setUploadingAvatar(false)
  }

  if (loading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><div className="w-10 h-10 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin" /></div>
  }

  if (!profile) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-center">
        <div><AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-3" /><p className="text-sm text-gray-500">No se encontró tu perfil.</p></div>
      </div>
    )
  }

  const activeCampaigns = campaigns.filter(c => c.campaign?.status === 'active').length
  const pendingDeliverables = campaigns.reduce(
    (total, campaign) => total + (campaign.campaign_deliverables ?? []).filter(
      deliverable => !['approved', 'published'].includes(deliverable.status)
    ).length,
    0
  )
  const totalEarned     = payments.completed.reduce((s, p) => s + p.net_amount, 0)
  const currency        = payments.completed[0]?.currency ?? payments.pending[0]?.currency ?? 'CLP'
  const socialProfiles  = profile.influencer_social_profiles ?? []
  const activeSocials   = socials.filter(s => !s._delete)
  const profileComplete = isProfileComplete(profile)

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Mi Perfil</h1>
        <div className="flex items-center gap-2">
          {!editing && <button onClick={load} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400"><RefreshCw className="h-4 w-4" /></button>}
          {editing ? (
            <>
              {profileComplete && (
                <button onClick={() => setEditing(false)} className="flex items-center gap-1 text-sm text-gray-500 px-3 py-1.5 rounded-lg hover:bg-gray-100">
                  <X className="h-4 w-4" /> Cancelar
                </button>
              )}
              <button onClick={saveProfile} disabled={saving} className="flex items-center gap-1 text-sm font-semibold bg-violet-600 text-white px-4 py-1.5 rounded-lg hover:bg-violet-700 disabled:opacity-50">
                <Save className="h-4 w-4" /> {saving ? 'Guardando…' : 'Guardar'}
              </button>
            </>
          ) : (
            <button onClick={startEdit} className="flex items-center gap-1.5 text-sm font-semibold bg-violet-600 text-white px-4 py-1.5 rounded-lg hover:bg-violet-700">
              <Edit2 className="h-4 w-4" /> Editar perfil
            </button>
          )}
        </div>
      </div>

      {/* VIEW MODE */}
      {!editing && (
        <>
          <div className="bg-white rounded-2xl border border-gray-100 p-6">
            <div className="flex items-start gap-5">
              <div className="flex-shrink-0">
                {profile.avatar_url ? (
                  <img src={profile.avatar_url} alt={profile.display_name} onError={() => setProfile(prev => prev ? { ...prev, avatar_url: null } : prev)} className="w-20 h-20 rounded-2xl object-cover" />
                ) : (
                  <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center text-white font-bold text-3xl">
                    {profile.display_name.charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0 space-y-1.5">
                <h2 className="text-lg font-bold text-gray-900">{profile.display_name}</h2>
                {profile.email && <div className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5 text-gray-300" /><span className="text-sm text-gray-400">{profile.email}</span></div>}
                {profile.phone && <div className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5 text-gray-300" /><span className="text-sm text-gray-400">{profile.phone}</span></div>}
                {profile.address && <div className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-gray-300" /><span className="text-sm text-gray-400">{profile.address}</span></div>}
                {(profile.commune || profile.city || profile.country) && <div className="flex items-center gap-1.5"><Globe className="h-3.5 w-3.5 text-gray-300" /><span className="text-sm text-gray-400">{[profile.commune, profile.city, profile.country].filter(Boolean).join(', ')}</span></div>}
                {profile.birth_date && <div className="flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5 text-gray-300" /><span className="text-sm text-gray-400">{new Date(profile.birth_date).toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })}</span></div>}
                {profile.categories && profile.categories.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap pt-1">
                    <Tag className="h-3.5 w-3.5 text-gray-300 flex-shrink-0" />
                    {profile.categories.map(cat => (
                      <span key={cat} className="text-[11px] font-medium bg-violet-50 text-violet-700 px-2 py-0.5 rounded-full capitalize">{cat}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {profile.bio && (
              <div className="mt-5 pt-5 border-t border-gray-50">
                <div className="flex items-center gap-2 mb-2"><User className="h-3.5 w-3.5 text-gray-300" /><span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Bio</span></div>
                <p className="text-sm text-gray-600 leading-relaxed">{profile.bio}</p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Campañas activas',  value: activeCampaigns,                icon: Target,   color: 'text-violet-600', bg: 'bg-violet-50' },
              { label: 'Entregables pendientes', value: pendingDeliverables,       icon: Zap,      color: 'text-amber-600',  bg: 'bg-amber-50' },
              { label: 'Total cobrado',     value: fmtMoney(totalEarned, currency), icon: Banknote, color: 'text-green-600',  bg: 'bg-green-50' },
              { label: 'Marcas referidas',  value: profile.referred_brands_count ?? 0, icon: Share2, color: 'text-blue-600',   bg: 'bg-blue-50' },
            ].map(({ label, value, icon: Icon, color, bg }) => (
              <div key={label} className="bg-white rounded-2xl border border-gray-100 p-4">
                <div className={cn('w-8 h-8 rounded-xl flex items-center justify-center mb-3', bg)}><Icon className={cn('h-4 w-4', color)} /></div>
                <div className="text-lg font-bold text-gray-900 truncate">{value}</div>
                <div className="text-xs text-gray-400 mt-0.5">{label}</div>
              </div>
            ))}
          </div>

          {socialProfiles.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-50">
                <Share2 className="h-4 w-4 text-gray-400" />
                <h2 className="text-sm font-bold text-gray-900">Redes Sociales</h2>
              </div>
              <div className="px-5 py-4 space-y-3">
                {socialProfiles.map(sp => (
                  <div key={sp.id ?? sp.platform} className="flex items-center gap-3">
                    <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-gradient-to-br', PLATFORM_COLORS[sp.platform] ?? 'from-gray-400 to-gray-300')}>
                      <span className="text-white text-xs font-bold">{sp.platform.charAt(0).toUpperCase()}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-500 capitalize">{sp.platform}</p>
                      {sp.username ? (
                        <a href={sp.profile_url ?? `https://www.${sp.platform}.com/${sp.username.replace(/^@/, '')}`} target="_blank" rel="noopener noreferrer" className="text-sm text-violet-600 hover:underline">
                          @{sp.username.replace(/^@/, '')}
                        </a>
                      ) : <span className="text-sm text-gray-300">—</span>}
                    </div>
                    <div className="text-right flex-shrink-0">
                      {sp.followers > 0 && <p className="text-sm font-bold text-gray-900">{sp.followers.toLocaleString('es-CL')}</p>}
                      {sp.engagement_rate && <p className="text-xs text-gray-400">{sp.engagement_rate.toFixed(1)}% eng.</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <NotificationPreferencesForm />
        </>
      )}

      {/* EDIT MODE */}
      {editing && (
        <div className="space-y-5">
          {!profileComplete && (
            <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              Para usar el portal necesitas completar Instagram, comuna y dirección.
            </div>
          )}
          {profileComplete && !editForm.birth_date.trim() && (
            <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              Para guardar cambios ahora necesitas completar tu fecha de nacimiento.
            </div>
          )}
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2"><Camera className="h-4 w-4 text-gray-400" /> Foto de perfil</h2>
            <div className="mt-4 flex items-center gap-4">
              <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-violet-500 to-pink-500 text-white flex items-center justify-center text-2xl font-bold">
                {(avatarPreview || profile.avatar_url) ? (
                  <img src={avatarPreview ?? profile.avatar_url ?? ''} alt="Vista previa" className="h-full w-full object-cover" onError={() => setAvatarPreview(null)} />
                ) : profile.display_name.charAt(0).toUpperCase()}
              </div>
              <div>
                <input ref={avatarInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={event => {
                  const file = event.target.files?.[0]
                  if (file) void uploadAvatar(file)
                  event.currentTarget.value = ''
                }} />
                <button type="button" disabled={uploadingAvatar} onClick={() => avatarInputRef.current?.click()} className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-60">
                  <ImagePlus className="h-4 w-4" /> {uploadingAvatar ? 'Subiendo foto…' : profile.avatar_url ? 'Cambiar foto' : 'Subir foto'}
                </button>
                <p className="mt-2 text-xs text-gray-400">JPG, PNG o WebP. Máximo 5 MB.</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
            <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2"><User className="h-4 w-4 text-gray-400" /> Información personal</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Nombre" value={editForm.display_name} onChange={v => setEditForm(f => ({ ...f, display_name: v }))} placeholder="Tu nombre" />
              <Field label="Teléfono" value={editForm.phone} onChange={v => setEditForm(f => ({ ...f, phone: v }))} type="tel" placeholder="+56 9 1234 5678" />
              <Field label="Fecha de nacimiento *" value={editForm.birth_date} onChange={v => setEditForm(f => ({ ...f, birth_date: v }))} type="date" />
            </div>
            <Field label="Bio" value={editForm.bio} onChange={v => setEditForm(f => ({ ...f, bio: v }))} textarea placeholder="Cuéntanos sobre ti…" />
            {/* Categorías como bubbles seleccionables */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-2">Categorías / Nichos</label>
              <div className="flex flex-wrap gap-2">
                {['Moda', 'Belleza', 'Fitness', 'Lifestyle', 'Gastronomía', 'Viajes', 'Tecnología', 'Gaming', 'Educación', 'Arte', 'Música', 'Deportes', 'Sustentabilidad', 'Familia', 'Humor', 'Finanzas', 'Salud', 'Mascotas'].map(cat => {
                  const current = editForm.categories ? editForm.categories.split(',').map(s => s.trim()).filter(Boolean) : []
                  const isSelected = current.some(c => c.toLowerCase() === cat.toLowerCase())
                  return (
                    <button key={cat} type="button"
                      onClick={() => {
                        const next = isSelected
                          ? current.filter(c => c.toLowerCase() !== cat.toLowerCase())
                          : [...current, cat]
                        setEditForm(f => ({ ...f, categories: next.join(', ') }))
                      }}
                      className={cn(
                        'text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors',
                        isSelected
                          ? 'bg-violet-600 text-white border-violet-600'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-violet-300 hover:text-violet-700'
                      )}
                    >
                      {cat}
                    </button>
                  )
                })}
              </div>
              <input type="text" value={editForm.categories} onChange={e => setEditForm(f => ({ ...f, categories: e.target.value }))}
                placeholder="O escribe tus categorías separadas por coma…"
                className="w-full mt-2 text-xs border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 outline-none focus:border-violet-400 text-gray-500" />
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
            <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2"><MapPin className="h-4 w-4 text-gray-400" /> Dirección y ubicación</h2>
            <Field label="Dirección completa *" value={editForm.address} onChange={v => setEditForm(f => ({ ...f, address: v }))} placeholder="Av. Providencia 1234, Depto 5" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Comuna *" value={editForm.commune} onChange={v => setEditForm(f => ({ ...f, commune: v }))} placeholder="Providencia" />
              <Field label="Ciudad" value={editForm.city} onChange={v => setEditForm(f => ({ ...f, city: v }))} placeholder="Santiago" />
            </div>
            <Field label="País" value={editForm.country} onChange={v => setEditForm(f => ({ ...f, country: v }))} placeholder="Chile" />
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2"><Share2 className="h-4 w-4 text-gray-400" /> Redes Sociales <span className="text-red-500 font-normal">(Instagram obligatorio)</span></h2>
              <button onClick={() => setSocials(prev => [...prev, { platform: 'instagram', username: '', followers: 0, engagement_rate: null, profile_url: null }])}
                className="flex items-center gap-1 text-xs font-semibold text-violet-600 hover:text-violet-700">
                <Plus className="h-3.5 w-3.5" /> Agregar red
              </button>
            </div>
            {activeSocials.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No hay redes. Haz clic en Agregar red.</p>}
            <div className="space-y-3">
              {socials.map((sp, idx) => {
                if (sp._delete) return null
                return (
                  <div key={idx} className="border border-gray-100 rounded-xl p-3 space-y-3">
                    <div className="flex items-center gap-2">
                      <select value={sp.platform} onChange={e => updateSocial(idx, 'platform', e.target.value)}
                        className="flex-1 text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-gray-50 outline-none focus:border-violet-400">
                        {PLATFORMS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                      </select>
                      <button onClick={() => setSocials(prev => prev.map((s, i) => i === idx ? { ...s, _delete: true } : s))}
                        className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] font-semibold text-gray-400 uppercase">Usuario{sp.platform === 'instagram' ? ' *' : ''}</label>
                        <input type="text" value={sp.username} onChange={e => updateSocial(idx, 'username', e.target.value)} placeholder="@usuario"
                          className="w-full mt-1 text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-gray-50 outline-none focus:border-violet-400" />
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold text-gray-400 uppercase">Seguidores</label>
                        <input type="number" value={sp.followers} onChange={e => updateSocial(idx, 'followers', parseInt(e.target.value) || 0)} placeholder="0"
                          className="w-full mt-1 text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-gray-50 outline-none focus:border-violet-400" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] font-semibold text-gray-400 uppercase">Engagement %</label>
                        <input type="number" step="0.1" value={sp.engagement_rate ?? ''} onChange={e => updateSocial(idx, 'engagement_rate', parseFloat(e.target.value) || null)} placeholder="3.5"
                          className="w-full mt-1 text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-gray-50 outline-none focus:border-violet-400" />
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold text-gray-400 uppercase">URL perfil</label>
                        <input type="url" value={sp.profile_url ?? ''} onChange={e => updateSocial(idx, 'profile_url', e.target.value || null)} placeholder="https://…"
                          className="w-full mt-1 text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-gray-50 outline-none focus:border-violet-400" />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <button onClick={saveProfile} disabled={saving}
            className="w-full py-3 text-sm font-semibold bg-violet-600 text-white rounded-2xl hover:bg-violet-700 disabled:opacity-50 flex items-center justify-center gap-2">
            <Save className="h-4 w-4" /> {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      )}
    </div>
  )
}
