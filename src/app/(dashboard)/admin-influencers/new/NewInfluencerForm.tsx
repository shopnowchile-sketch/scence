'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useForm, useFieldArray, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import usePlacesAutocomplete, { getGeocode, getLatLng } from 'use-places-autocomplete'
import {
  ChevronLeft, ChevronRight, Plus, Trash2,
  User, Share2, DollarSign, Check,
} from 'lucide-react'
import { cn, PLATFORM_ICONS, PLATFORM_LABELS, CATEGORY_OPTIONS, COUNTRY_OPTIONS } from '@/lib/utils'

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
  // Step 1 — personal
  display_name: z.string().min(2, 'Mínimo 2 caracteres'),
  first_name:   z.string().optional(),
  last_name:    z.string().optional(),
  email:        z.string().email('Email inválido').optional().or(z.literal('')),
  phone:        z.string().optional(),
  bio:          z.string().max(500).optional(),
  city:         z.string().optional(),
  country:      z.string().optional(),
  address:      z.string().optional(),
  address_lat:  z.number().optional(),
  address_lng:  z.number().optional(),
  categories:   z.array(z.string()).optional(),
  tags:         z.array(z.string()).optional(),
  is_verified:  z.boolean(),
  // Step 2 — social
  social_profiles: z.array(socialProfileSchema).min(1, 'Agrega al menos una red social'),
  // Step 3 — rates
  rate_cards: z.array(rateCardSchema).optional(),
})

type FormValues = z.infer<typeof schema>

const PLATFORMS = ['instagram', 'tiktok', 'youtube', 'twitter', 'facebook', 'linkedin'] as const
const SERVICE_TYPES = [
  'instagram_post', 'instagram_reel', 'instagram_story',
  'tiktok', 'youtube', 'youtube_short',
  'blog', 'podcast', 'event_appearance', 'live_stream', 'ugc_video', 'ugc_photo',
]
const CURRENCIES = ['USD', 'EUR', 'MXN', 'CLP', 'COP', 'ARS', 'BRL', 'GBP'] as const
const STEPS = [
  { id: 1, label: 'Datos',    icon: User },
  { id: 2, label: 'Redes',    icon: Share2 },
  { id: 3, label: 'Tarifas',  icon: DollarSign },
  { id: 4, label: 'Confirmar',icon: Check },
]

// ── Address autocomplete ──────────────────────────────────────────────────────
function AddressAutocomplete({
  value,
  onChange,
  onSelect,
}: {
  value: string
  onChange: (v: string) => void
  onSelect: (address: string, lat: number, lng: number) => void
}) {
  const {
    ready, suggestions: { status, data }, setValue, clearSuggestions,
  } = usePlacesAutocomplete({ debounce: 300, callbackName: 'initPlaces' })

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    setValue(e.target.value)
    onChange(e.target.value)
  }

  const handleSelect = async (description: string) => {
    setValue(description, false)
    onChange(description)
    clearSuggestions()
    try {
      const results = await getGeocode({ address: description })
      const { lat, lng } = await getLatLng(results[0])
      onSelect(description, lat, lng)
    } catch {}
  }

  return (
    <div className="relative">
      <input
        className="input-base w-full"
        placeholder="Buscar dirección…"
        value={value}
        onChange={handleInput}
        disabled={!ready}
      />
      {status === 'OK' && (
        <ul className="absolute z-50 w-full bg-white border border-gray-200 rounded-xl shadow-lg mt-1 overflow-hidden">
          {data.map(({ place_id, description }) => (
            <li key={place_id}
              className="px-4 py-2.5 text-sm text-gray-700 hover:bg-violet-50 hover:text-violet-700 cursor-pointer transition-colors"
              onClick={() => handleSelect(description)}>
              {description}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

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
export function NewInfluencerForm() {
  const router = useRouter()
  const [step, setStep]   = useState(1)
  const [saving, setSaving] = useState(false)

  const { register, control, handleSubmit, watch, trigger, setValue, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      is_verified: false,
      social_profiles: [{ platform: 'instagram', username: '', followers_count: 0, engagement_rate: 0, is_primary: true }],
      rate_cards: [],
      categories: [],
      tags: [],
    },
  })

  const { fields: profileFields, append: addProfile, remove: removeProfile } = useFieldArray({ control, name: 'social_profiles' })
  const { fields: rateFields, append: addRate, remove: removeRate } = useFieldArray({ control, name: 'rate_cards' })
  const values = watch()

  async function goNext() {
    const stepFields: Record<number, (keyof FormValues)[]> = {
      1: ['display_name'],
      2: ['social_profiles'],
      3: [],
    }
    const ok = await trigger(stepFields[step] ?? [])
    if (ok) setStep(s => s + 1)
  }

  async function onSubmit(data: FormValues) {
    setSaving(true)
    try {
      const res = await fetch('/api/influencers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Error al crear influencer')
      }
      const { data: influencer } = await res.json()
      toast.success('Influencer agregado al roster')
      router.push(`/influencers/${influencer.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setSaving(false)
    }
  }

  // ── Step 1 — Datos personales ──────────────────────────────────────────────
  function Step1() {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Nombre artístico / display name <span className="text-red-500">*</span>
            </label>
            <input {...register('display_name')} className="input-base w-full" placeholder="Valentina Reyes" />
            {errors.display_name && <p className="text-xs text-red-500 mt-1">{errors.display_name.message}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Nombre real</label>
            <input {...register('first_name')} className="input-base w-full" placeholder="Valentina" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Apellido</label>
            <input {...register('last_name')} className="input-base w-full" placeholder="Reyes" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
            <input {...register('email')} type="email" className="input-base w-full" placeholder="vale@talent.mx" />
            {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email.message}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Teléfono</label>
            <input {...register('phone')} className="input-base w-full" placeholder="+52 55 0000 0000" />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Bio</label>
          <textarea {...register('bio')} rows={3} className="input-base w-full resize-none"
            placeholder="Breve descripción del influencer…" />
        </div>

        {/* Location */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Ciudad</label>
            <input {...register('city')} className="input-base w-full" placeholder="Ciudad de México" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">País</label>
            <select {...register('country')} className="input-base w-full">
              <option value="">Seleccionar…</option>
              {COUNTRY_OPTIONS.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Dirección (Google Maps)</label>
            <Controller
              control={control}
              name="address"
              render={({ field }) => (
                <AddressAutocomplete
                  value={field.value ?? ''}
                  onChange={field.onChange}
                  onSelect={(address, lat, lng) => {
                    setValue('address', address)
                    setValue('address_lat', lat)
                    setValue('address_lng', lng)
                  }}
                />
              )}
            />
          </div>
        </div>

        {/* Categories */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-3">Categorías</label>
          <Controller
            control={control}
            name="categories"
            render={({ field }) => (
              <div className="flex flex-wrap gap-2">
                {CATEGORY_OPTIONS.map(cat => {
                  const active = field.value?.includes(cat)
                  return (
                    <button key={cat} type="button"
                      onClick={() => {
                        const next = active
                          ? (field.value ?? []).filter(v => v !== cat)
                          : [...(field.value ?? []), cat]
                        field.onChange(next)
                      }}
                      className={cn(
                        'px-3 py-1.5 rounded-full border text-sm font-medium transition-all',
                        active ? 'border-violet-500 bg-violet-50 text-violet-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      )}>
                      {cat}
                    </button>
                  )
                })}
              </div>
            )}
          />
        </div>

        {/* Tags */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Tags internos <span className="text-gray-400 text-xs">(opcional)</span>
          </label>
          <Controller control={control} name="tags"
            render={({ field }) => <TagInput value={field.value} onChange={field.onChange} placeholder="nike, premium, cdmx" />}
          />
        </div>

        {/* Verificado */}
        <div className="flex items-center gap-3 p-4 rounded-xl border border-gray-200 bg-gray-50">
          <Controller control={control} name="is_verified"
            render={({ field }) => (
              <button type="button" role="switch" aria-checked={field.value}
                onClick={() => field.onChange(!field.value)}
                className={cn('relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0',
                  field.value ? 'bg-violet-600' : 'bg-gray-300')}>
                <span className={cn('inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
                  field.value ? 'translate-x-4' : 'translate-x-0.5')} />
              </button>
            )}
          />
          <div>
            <div className="text-sm font-medium text-gray-800">Verificado</div>
            <div className="text-xs text-gray-400">Marca el influencer como verificado y confiable</div>
          </div>
        </div>
      </div>
    )
  }

  // ── Step 2 — Social profiles ───────────────────────────────────────────────
  function Step2() {
    return (
      <div className="space-y-5">
        {profileFields.map((field, i) => (
          <div key={field.id} className="card p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xl">{PLATFORM_ICONS[values.social_profiles?.[i]?.platform ?? 'instagram']}</span>
                <span className="text-sm font-semibold text-gray-700">
                  {PLATFORM_LABELS[values.social_profiles?.[i]?.platform ?? ''] ?? 'Red social'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Controller control={control} name={`social_profiles.${i}.is_primary`}
                  render={({ field: f }) => (
                    <button type="button"
                      onClick={() => {
                        // Only one primary at a time
                        profileFields.forEach((_, j) => setValue(`social_profiles.${j}.is_primary`, j === i))
                      }}
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
                  <input {...register(`social_profiles.${i}.username`)}
                    className="input-base w-full pl-7 text-sm" placeholder="usuario" />
                </div>
                {errors.social_profiles?.[i]?.username && (
                  <p className="text-xs text-red-500 mt-1">{errors.social_profiles[i]?.username?.message}</p>
                )}
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">URL del perfil</label>
                <input {...register(`social_profiles.${i}.profile_url`)}
                  className="input-base w-full text-sm" placeholder="https://instagram.com/..." />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Seguidores</label>
                <input type="number" {...register(`social_profiles.${i}.followers_count`, { valueAsNumber: true })}
                  className="input-base w-full text-sm" placeholder="100000" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Engagement rate (%)</label>
                <input type="number" step="0.1" {...register(`social_profiles.${i}.engagement_rate`, { valueAsNumber: true })}
                  className="input-base w-full text-sm" placeholder="4.5" />
              </div>
            </div>
          </div>
        ))}

        <button type="button"
          onClick={() => addProfile({ platform: 'tiktok', username: '', followers_count: 0, engagement_rate: 0, is_primary: false })}
          className="flex items-center gap-2 w-full py-3 border-2 border-dashed border-gray-200 rounded-xl text-sm font-medium text-gray-500 hover:border-violet-300 hover:text-violet-600 transition-colors">
          <Plus className="h-4 w-4" /> Agregar otra red social
        </button>

        {errors.social_profiles && typeof errors.social_profiles === 'object' && 'message' in errors.social_profiles && (
          <p className="text-xs text-red-500">{(errors.social_profiles as { message: string }).message}</p>
        )}
      </div>
    )
  }

  // ── Step 3 — Rate cards ────────────────────────────────────────────────────
  function Step3() {
    return (
      <div className="space-y-4">
        <p className="text-sm text-gray-500">Define las tarifas base de este influencer. Se pueden ajustar por campaña.</p>

        {rateFields.map((field, i) => (
          <div key={field.id} className="card p-4">
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
                  {SERVICE_TYPES.map(s => (
                    <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                  ))}
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
                <input type="number" step="100"
                  {...register(`rate_cards.${i}.base_rate`, { valueAsNumber: true })}
                  className="input-base w-full text-sm" placeholder="2500" />
                {errors.rate_cards?.[i]?.base_rate && (
                  <p className="text-xs text-red-500 mt-1">{errors.rate_cards[i]?.base_rate?.message}</p>
                )}
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-gray-500 mb-1">Notas</label>
                <input {...register(`rate_cards.${i}.notes`)}
                  className="input-base w-full text-sm" placeholder="Ej. Incluye 5 stories" />
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
    )
  }

  // ── Step 4 — Resumen ───────────────────────────────────────────────────────
  function Step4() {
    const primaryProfile = values.social_profiles?.find(sp => sp.is_primary) ?? values.social_profiles?.[0]
    return (
      <div className="space-y-4">
        <p className="text-sm text-gray-500">Confirma los datos antes de agregar al roster.</p>
        <div className="card divide-y divide-gray-100">
          {[
            ['Nombre',       values.display_name],
            ['Email',        values.email || '—'],
            ['Ubicación',    [values.city, values.country].filter(Boolean).join(', ') || '—'],
            ['Categorías',   values.categories?.join(', ') || '—'],
            ['Redes sociales', values.social_profiles?.map(sp => `@${sp.username} (${PLATFORM_LABELS[sp.platform] ?? sp.platform})`).join(', ')],
            ['Seguidores (principal)', primaryProfile ? primaryProfile.followers_count.toLocaleString('es-CL') : '—'],
            ['Tarifas',      values.rate_cards?.length ? `${values.rate_cards.length} tarifa(s) definidas` : 'Sin tarifas'],
            ['Verificado',   values.is_verified ? 'Sí' : 'No'],
          ].map(([label, val]) => (
            <div key={label as string} className="flex justify-between py-3 px-4 text-sm">
              <span className="text-gray-400 font-medium">{label}</span>
              <span className="text-gray-800 font-semibold text-right max-w-[55%] truncate">{val}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => router.back()}
          className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-500">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Nuevo influencer</h1>
          <p className="text-sm text-gray-400">Paso {step} de {STEPS.length}</p>
        </div>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2">
        {STEPS.map((s, i) => {
          const Icon = s.icon
          const done = step > s.id
          const active = step === s.id
          return (
            <div key={s.id} className="flex items-center gap-2 flex-1">
              <div className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all',
                active ? 'bg-violet-600 text-white' : done ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400'
              )}>
                {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                <span className="hidden sm:inline">{s.label}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={cn('h-px flex-1', done ? 'bg-emerald-300' : 'bg-gray-200')} />
              )}
            </div>
          )
        })}
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit(onSubmit)}>
        <div className="card p-6">
          {step === 1 && <Step1 />}
          {step === 2 && <Step2 />}
          {step === 3 && <Step3 />}
          {step === 4 && <Step4 />}
        </div>

        <div className="flex justify-between mt-4">
          <button type="button"
            onClick={() => setStep(s => Math.max(1, s - 1))}
            disabled={step === 1}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-gray-600 rounded-xl border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            <ChevronLeft className="h-4 w-4" /> Anterior
          </button>

          {step < STEPS.length ? (
            <button type="button" onClick={goNext}
              className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700 transition-colors">
              Siguiente <ChevronRight className="h-4 w-4" />
            </button>
          ) : (
            <button type="submit" disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors">
              {saving ? (
                <><div className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" /> Guardando…</>
              ) : (
                <><Check className="h-4 w-4" /> Agregar al roster</>
              )}
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
