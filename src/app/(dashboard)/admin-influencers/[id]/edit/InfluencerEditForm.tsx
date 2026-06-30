'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm, Controller, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import Link from 'next/link'
import {
  ChevronLeft, Loader2, AlertCircle, Save, Plus, Trash2,
} from 'lucide-react'
import { cn, PLATFORM_ICONS, PLATFORM_LABELS, CATEGORY_OPTIONS, COUNTRY_OPTIONS } from '@/lib/utils'
import { useInfluencer } from '@/hooks/useInfluencersList'
import type { SocialProfile, RateCard } from '@/types'

// ── Schema ────────────────────────────────────────────────────────────────────
const socialProfileSchema = z.object({
  platform:        z.string().min(1),
  username:        z.string().min(1, 'Requerido'),
  profile_url:     z.string().url('URL inválida').optional().or(z.literal('')),
  followers_count: z.number().min(0),
  engagement_rate: z.number().min(0).max(100),
  is_primary:      z.boolean(),
})

const rateCardSchema = z.object({
  service_type: z.string().min(1),
  base_rate:    z.number().positive('Debe ser > 0'),
  currency:     z.enum(['USD', 'EUR', 'MXN', 'CLP', 'COP', 'ARS', 'BRL', 'GBP']),
  notes:        z.string().optional(),
})

const schema = z.object({
  display_name:        z.string().min(2, 'Mínimo 2 caracteres'),
  email:               z.string().email('Email inválido').optional().or(z.literal('')),
  phone:               z.string().optional(),
  bio:                 z.string().max(500).optional(),
  city:                z.string().optional(),
  country:             z.string().optional(),
  address:             z.string().optional(),
  categories:          z.array(z.string()).optional(),
  is_verified:         z.boolean(),
  is_active:           z.boolean(),
  deactivation_reason: z.string().optional(),
  social_profiles: z.array(socialProfileSchema).min(1, 'Al menos una red social'),
  rate_cards:      z.array(rateCardSchema).optional(),
})

type FormValues = z.infer<typeof schema>

const PLATFORMS = ['instagram', 'tiktok', 'youtube', 'twitter', 'facebook', 'linkedin'] as const
const SERVICE_TYPES = [
  'instagram_post', 'instagram_reel', 'instagram_story',
  'tiktok', 'youtube', 'youtube_short',
  'blog', 'podcast', 'event_appearance', 'live_stream', 'ugc_video', 'ugc_photo',
]
const CURRENCIES = ['USD', 'EUR', 'MXN', 'CLP', 'COP', 'ARS', 'BRL', 'GBP'] as const

// ── Tag input ─────────────────────────────────────────────────────────────────
function TagInput({ value = [], onChange, placeholder }: { value?: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [input, setInput] = useState('')
  function add() {
    const t = input.trim().toLowerCase()
    if (t && !value.includes(t)) onChange([...value, t])
    setInput('')
  }
  return (
    <div>
      <div className="flex gap-2 mb-2">
        <input className="input-base flex-1" placeholder={placeholder ?? 'Agregar…'}
          value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }} />
        <button type="button" onClick={add}
          className="px-3 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors">+</button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {value.map(t => (
          <span key={t} className="flex items-center gap-1 px-2 py-0.5 bg-gray-100 text-gray-600 text-xs font-medium rounded-full">
            {t}
            <button type="button" onClick={() => onChange(value.filter(x => x !== t))}
              className="hover:text-red-500 transition-colors">×</button>
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export function InfluencerEditForm({ id }: { id: string }) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)

  const { data: res, isLoading, error } = useInfluencer(id)

  const { register, control, handleSubmit, reset, setValue, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      is_verified: false,
      social_profiles: [{ platform: 'instagram', username: '', followers_count: 0, engagement_rate: 0, is_primary: true }],
      rate_cards: [],
      categories: [],
    },
  })

  const { fields: profileFields, append: addProfile, remove: removeProfile } = useFieldArray({ control, name: 'social_profiles' })
  const { fields: rateFields, append: addRate, remove: removeRate } = useFieldArray({ control, name: 'rate_cards' })

  // Populate form once data loads
  useEffect(() => {
    if (res?.data) {
      const inf = res.data
      const socialProfiles = (inf.social_profiles ?? []).map((sp: SocialProfile) => ({
        platform:        String(sp.platform ?? 'instagram'),
        username:        String(sp.username ?? ''),
        profile_url:     String(sp.profile_url ?? ''),
        followers_count: Number(sp.followers ?? sp.followers_count ?? 0),
        engagement_rate: Number(sp.engagement_rate ?? 0),
        is_primary:      Boolean(sp.is_primary),
      }))
      const rateCards = (inf.rate_cards ?? []).map((rc: RateCard) => ({
        service_type: String(rc.service_type ?? rc.deliverable_type ?? ''),
        base_rate:    Number(rc.base_rate ?? 0),
        currency:     (rc.currency ?? 'USD') as typeof CURRENCIES[number],
        notes:        String(rc.notes ?? ''),
      }))
      const meta = (inf.metadata ?? {}) as Record<string, unknown>
      reset({
        display_name:        inf.display_name ?? '',
        email:               inf.email ?? '',
        phone:               inf.phone ?? '',
        bio:                 inf.bio ?? '',
        city:                inf.city ?? '',
        country:             inf.country ?? '',
        address:             (inf.address ?? meta.address ?? '') as string,
        categories:          (inf.categories ?? []) as string[],
        is_verified:         Boolean(inf.is_verified),
        is_active:           inf.is_active !== false,
        deactivation_reason: (meta.deactivation_reason ?? '') as string,
        social_profiles: socialProfiles.length > 0 ? socialProfiles : [{ platform: 'instagram', username: '', followers_count: 0, engagement_rate: 0, is_primary: true }],
        rate_cards:   rateCards,
      })
    }
  }, [res, reset])

  async function onSubmit(data: FormValues) {
    setSaving(true)
    try {
      const res = await fetch(`/api/influencers/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          email:   data.email   || null,
          phone:   data.phone   || null,
          bio:     data.bio     || null,
          city:    data.city    || null,
          country: data.country || null,
          address: data.address || null,
          is_active: data.is_active,
          metadata: {
            deactivation_reason: data.is_active ? null : (data.deactivation_reason || null),
          },
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Error al guardar')
      }
      toast.success('Influencer actualizado')
      router.push(`/admin-influencers/${id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 text-violet-400 animate-spin" />
      </div>
    )
  }

  if (error || !res?.data) {
    return (
      <div className="card p-12 text-center max-w-lg mx-auto mt-12">
        <AlertCircle className="h-10 w-10 text-red-300 mx-auto mb-3" />
        <p className="text-gray-500 font-medium">Influencer no encontrado</p>
        <Link href="/admin-influencers" className="mt-4 inline-block text-sm text-violet-600 hover:underline">
          Volver al roster
        </Link>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href={`/admin-influencers/${id}`}
          className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-500">
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Editar influencer</h1>
          <p className="text-sm text-gray-400">{res.data.display_name}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        {/* ── Datos personales ── */}
        <div className="card p-6 space-y-5">
          <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider">Datos personales</h2>

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Nombre artístico / display name <span className="text-red-500">*</span>
              </label>
              <input {...register('display_name')} className="input-base w-full" />
              {errors.display_name && <p className="text-xs text-red-500 mt-1">{errors.display_name.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
              <input {...register('email')} type="email" className="input-base w-full" />
              {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Teléfono</label>
              <input {...register('phone')} className="input-base w-full" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Ciudad</label>
              <input {...register('city')} className="input-base w-full" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">País</label>
              <select {...register('country')} className="input-base w-full">
                <option value="">Seleccionar…</option>
                {COUNTRY_OPTIONS.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Dirección</label>
              <input {...register('address')} className="input-base w-full" placeholder="Ej. Av. Providencia 1234, Santiago" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Bio</label>
              <textarea {...register('bio')} rows={3} className="input-base w-full resize-none" />
            </div>
          </div>

          {/* Categories */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">Categorías</label>
            <Controller control={control} name="categories" render={({ field }) => (
              <div className="flex flex-wrap gap-2">
                {CATEGORY_OPTIONS.map(cat => {
                  const active = field.value?.includes(cat)
                  return (
                    <button key={cat} type="button"
                      onClick={() => {
                        const next = active ? (field.value ?? []).filter(v => v !== cat) : [...(field.value ?? []), cat]
                        field.onChange(next)
                      }}
                      className={cn('px-3 py-1.5 rounded-full border text-sm font-medium transition-all',
                        active ? 'border-violet-500 bg-violet-50 text-violet-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      )}>
                      {cat}
                    </button>
                  )
                })}
              </div>
            )} />
          </div>

          {/* Verificado toggle */}
          <div className="flex items-center gap-3 p-4 rounded-xl border border-gray-200 bg-gray-50">
            <Controller control={control} name="is_verified" render={({ field }) => (
              <button type="button" role="switch" aria-checked={field.value}
                onClick={() => field.onChange(!field.value)}
                className={cn('relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0',
                  field.value ? 'bg-violet-600' : 'bg-gray-300')}>
                <span className={cn('inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
                  field.value ? 'translate-x-4' : 'translate-x-0.5')} />
              </button>
            )} />
            <div>
              <div className="text-sm font-medium text-gray-800">Verificado</div>
              <div className="text-xs text-gray-400">Marca el influencer como verificado y confiable</div>
            </div>
          </div>

          {/* Estado activo/inactivo */}
          <Controller control={control} name="is_active" render={({ field }) => (
            <div className={cn(
              'p-4 rounded-xl border-2 space-y-3',
              field.value ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'
            )}>
              <div className="flex items-center gap-3">
                <button type="button" role="switch" aria-checked={field.value}
                  onClick={() => field.onChange(!field.value)}
                  className={cn('relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0',
                    field.value ? 'bg-emerald-500' : 'bg-red-400')}>
                  <span className={cn('inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
                    field.value ? 'translate-x-4' : 'translate-x-0.5')} />
                </button>
                <div>
                  <div className={cn('text-sm font-semibold', field.value ? 'text-emerald-800' : 'text-red-800')}>
                    {field.value ? '✓ Influencer activa' : '✕ Influencer desactivada'}
                  </div>
                  <div className="text-xs text-gray-500">
                    {field.value ? 'Aparece en búsquedas y puede asignarse a campañas' : 'No aparece en búsquedas ni en asignación de campañas'}
                  </div>
                </div>
              </div>
              {!field.value && (
                <div>
                  <label className="block text-xs font-medium text-red-700 mb-1">Razón de desactivación</label>
                  <input {...register('deactivation_reason')}
                    className="input-base w-full text-sm"
                    placeholder="Ej. No responde, contenido inapropiado, solicitud propia…" />
                </div>
              )}
            </div>
          )} />
        </div>

        {/* ── Redes sociales ── */}
        <div className="card p-6 space-y-4">
          <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider">Redes sociales</h2>

          {profileFields.map((field, i) => (
            <div key={field.id} className="p-4 rounded-xl border border-gray-200 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-700">Perfil {i + 1}</span>
                <div className="flex items-center gap-2">
                  <Controller control={control} name={`social_profiles.${i}.is_primary`}
                    render={({ field: f }) => (
                      <button type="button"
                        onClick={() => profileFields.forEach((_, j) => setValue(`social_profiles.${j}.is_primary`, j === i))}
                        className={cn('text-xs font-medium px-2.5 py-1 rounded-full transition-all',
                          f.value ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200')}>
                        {f.value ? '★ Principal' : 'Marcar principal'}
                      </button>
                    )}
                  />
                  {profileFields.length > 1 && (
                    <button type="button" onClick={() => removeProfile(i)}
                      className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Plataforma</label>
                  <select {...register(`social_profiles.${i}.platform`)} className="input-base w-full text-sm">
                    {PLATFORMS.map(p => <option key={p} value={p}>{PLATFORM_LABELS[p] ?? p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Usuario / handle</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">@</span>
                    <input {...register(`social_profiles.${i}.username`)} className="input-base w-full pl-7 text-sm" placeholder="usuario" />
                  </div>
                  {errors.social_profiles?.[i]?.username && (
                    <p className="text-xs text-red-500 mt-1">{errors.social_profiles[i]?.username?.message}</p>
                  )}
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">URL del perfil</label>
                  <input {...register(`social_profiles.${i}.profile_url`)} className="input-base w-full text-sm" placeholder="https://..." />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Seguidores</label>
                  <input type="number" {...register(`social_profiles.${i}.followers_count`, { valueAsNumber: true })} className="input-base w-full text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Engagement (%)</label>
                  <input type="number" step="0.1" {...register(`social_profiles.${i}.engagement_rate`, { valueAsNumber: true })} className="input-base w-full text-sm" />
                </div>
              </div>
            </div>
          ))}

          <button type="button"
            onClick={() => addProfile({ platform: 'tiktok', username: '', followers_count: 0, engagement_rate: 0, is_primary: false })}
            className="flex items-center gap-2 w-full py-3 border-2 border-dashed border-gray-200 rounded-xl text-sm font-medium text-gray-500 hover:border-violet-300 hover:text-violet-600 transition-colors">
            <Plus className="h-4 w-4" /> Agregar otra red social
          </button>
        </div>

        {/* ── Tarifas ── */}
        <div className="card p-6 space-y-4">
          <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider">Tarifas</h2>

          {rateFields.map((field, i) => (
            <div key={field.id} className="p-4 rounded-xl border border-gray-200">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-gray-700">Tarifa {i + 1}</span>
                <button type="button" onClick={() => removeRate(i)}
                  className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">Tipo de servicio</label>
                  <select {...register(`rate_cards.${i}.service_type`)} className="input-base w-full text-sm">
                    {SERVICE_TYPES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Moneda</label>
                  <select {...register(`rate_cards.${i}.currency`)} className="input-base w-full text-sm">
                    {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Tarifa base</label>
                  <input type="number" step="100" {...register(`rate_cards.${i}.base_rate`, { valueAsNumber: true })} className="input-base w-full text-sm" />
                  {errors.rate_cards?.[i]?.base_rate && (
                    <p className="text-xs text-red-500 mt-1">{errors.rate_cards[i]?.base_rate?.message}</p>
                  )}
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">Notas</label>
                  <input {...register(`rate_cards.${i}.notes`)} className="input-base w-full text-sm" placeholder="Ej. Incluye 5 stories" />
                </div>
              </div>
            </div>
          ))}

          <button type="button"
            onClick={() => addRate({ service_type: 'instagram_post', base_rate: 0, currency: 'CLP', notes: '' })}
            className="flex items-center gap-2 w-full py-3 border-2 border-dashed border-gray-200 rounded-xl text-sm font-medium text-gray-500 hover:border-violet-300 hover:text-violet-600 transition-colors">
            <Plus className="h-4 w-4" /> Agregar tarifa
          </button>
        </div>

        {/* Actions */}
        <div className="flex justify-between">
          <Link href={`/admin-influencers/${id}`}
            className="px-4 py-2.5 text-sm font-medium text-gray-600 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors">
            Cancelar
          </Link>
          <button type="submit" disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700 disabled:opacity-60 transition-colors">
            {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Guardando…</> : <><Save className="h-4 w-4" /> Guardar cambios</>}
          </button>
        </div>
      </form>
    </div>
  )
}
