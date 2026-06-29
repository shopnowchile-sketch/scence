'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  AlertCircle, RefreshCw, Edit2, Save, X, Plus, Trash2,
  Target, Zap, Banknote, MapPin, Tag, Share2, Mail, User,
  Phone, Globe,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

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
  categories: string[] | null
  influencer_social_profiles: SocialProfile[] | null
}

type Task     = { id: string; status: string }
type Campaign = { id: string; campaign: { status: string } | null }
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
  const [tasks,     setTasks]     = useState<Task[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [payments,  setPayments]  = useState<{ pending: Payment[]; completed: Payment[] }>({ pending: [], completed: [] })
  const [loading,   setLoading]   = useState(true)
  const [editing,   setEditing]   = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [editForm,  setEditForm]  = useState({ display_name: '', bio: '', phone: '', city: '', country: '', address: '', categories: '' })
  const [socials,   setSocials]   = useState<SocialProfile[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [meRes, tasksRes, campRes, payRes] = await Promise.all([
        fetch('/api/influencer/me'),
        fetch('/api/influencer/tasks'),
        fetch('/api/influencer/campaigns'),
        fetch('/api/influencer/payments'),
      ])
      if (!meRes.ok) { toast.error('Error cargando perfil'); setLoading(false); return }
      const [meData, tasksData, campData, payData] = await Promise.all([meRes.json(), tasksRes.json(), campRes.json(), payRes.json()])
      setProfile(meData.data)
      setTasks(tasksData.data ?? [])
      setCampaigns(campData.data ?? [])
      setPayments({ pending: payData.pending ?? [], completed: payData.completed ?? [] })
    } catch { toast.error('Error cargando perfil') }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function startEdit() {
    if (!profile) return
    setEditForm({
      display_name: profile.display_name ?? '',
      bio: profile.bio ?? '',
      phone: profile.phone ?? '',
      city: profile.city ?? '',
      country: profile.country ?? '',
      address: profile.address ?? '',
      categories: (profile.categories ?? []).join(', '),
    })
    setSocials((profile.influencer_social_profiles ?? []).map(sp => ({ ...sp })))
    setEditing(true)
  }

  async function saveProfile() {
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
  const pendingTasks    = tasks.filter(t => t.status !== 'done' && t.status !== 'skipped').length
  const totalEarned     = payments.completed.reduce((s, p) => s + p.net_amount, 0)
  const currency        = payments.completed[0]?.currency ?? payments.pending[0]?.currency ?? 'CLP'
  const socialProfiles  = profile.influencer_social_profiles ?? []
  const activeSocials   = socials.filter(s => !s._delete)

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Mi Perfil</h1>
        <div className="flex items-center gap-2">
          {!editing && <button onClick={load} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400"><RefreshCw className="h-4 w-4" /></button>}
          {editing ? (
            <>
              <button onClick={() => setEditing(false)} className="flex items-center gap-1 text-sm text-gray-500 px-3 py-1.5 rounded-lg hover:bg-gray-100">
                <X className="h-4 w-4" /> Cancelar
              </button>
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
                  <img src={profile.avatar_url} alt={profile.display_name} className="w-20 h-20 rounded-2xl object-cover" />
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
                {(profile.city || profile.country) && <div className="flex items-center gap-1.5"><Globe className="h-3.5 w-3.5 text-gray-300" /><span className="text-sm text-gray-400">{[profile.city, profile.country].filter(Boolean).join(', ')}</span></div>}
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

          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Campañas activas',  value: activeCampaigns,                icon: Target,   color: 'text-violet-600', bg: 'bg-violet-50' },
              { label: 'Tareas pendientes', value: pendingTasks,                   icon: Zap,      color: 'text-amber-600',  bg: 'bg-amber-50' },
              { label: 'Total cobrado',     value: fmtMoney(totalEarned, currency), icon: Banknote, color: 'text-green-600',  bg: 'bg-green-50' },
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
        </>
      )}

      {/* EDIT MODE */}
      {editing && (
        <div className="space-y-5">
          <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
            <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2"><User className="h-4 w-4 text-gray-400" /> Información personal</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Nombre" value={editForm.display_name} onChange={v => setEditForm(f => ({ ...f, display_name: v }))} placeholder="Tu nombre" />
              <Field label="Teléfono" value={editForm.phone} onChange={v => setEditForm(f => ({ ...f, phone: v }))} type="tel" placeholder="+56 9 1234 5678" />
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
            <Field label="Dirección completa" value={editForm.address} onChange={v => setEditForm(f => ({ ...f, address: v }))} placeholder="Av. Providencia 1234, Depto 5" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Ciudad" value={editForm.city} onChange={v => setEditForm(f => ({ ...f, city: v }))} placeholder="Santiago" />
              <Field label="País" value={editForm.country} onChange={v => setEditForm(f => ({ ...f, country: v }))} placeholder="Chile" />
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2"><Share2 className="h-4 w-4 text-gray-400" /> Redes Sociales</h2>
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
                        <label className="text-[10px] font-semibold text-gray-400 uppercase">Usuario</label>
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
