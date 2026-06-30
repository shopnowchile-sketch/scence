'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { ChevronLeft, Loader2, AlertCircle, Save } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { PLATFORM_ICONS, PLATFORM_LABELS } from '@/lib/utils'
import { useCampaignDetail, usePatchCampaign } from '@/hooks/useCampaignsList'

// ── Schema ────────────────────────────────────────────────────────────────────
const nanToUndef = z.preprocess(
  (v) => (typeof v === 'number' && isNaN(v)) ? undefined : v,
  z.number().min(0).optional()
)
const nanToUndefPct = z.preprocess(
  (v) => (typeof v === 'number' && isNaN(v)) ? undefined : v,
  z.number().min(0).max(100).optional()
)

const DELIVERABLE_TYPES_EDIT = [
  { value: 'reel',             label: 'Reel',               emoji: '🎬' },
  { value: 'story',            label: 'Stories',             emoji: '📸' },
  { value: 'post',             label: 'Post / Feed',         emoji: '🖼️' },
  { value: 'live',             label: 'Live',                emoji: '🔴' },
  { value: 'event_attendance', label: 'Confirmar asistencia',emoji: '📅' },
  { value: 'event_checkin',    label: 'Check-in en evento',  emoji: '✅' },
  { value: 'ugc_video',        label: 'Video UGC',           emoji: '📹' },
  { value: 'blog_post',        label: 'Blog / Artículo',     emoji: '✍️' },
]

const schema = z.object({
  name:                  z.string().min(3, 'Mínimo 3 caracteres').max(120),
  description:           z.string().max(500).optional(),
  type:                  z.enum(['sponsored_post', 'ambassador', 'ugc', 'event_appearance', 'product_seeding', 'live', 'commission']),
  platforms:             z.array(z.string()).min(1, 'Selecciona al menos una plataforma'),
  start_date:            z.string().optional(),
  end_date:              z.string().optional(),
  budget_total:          nanToUndef,
  commission_rate:       nanToUndefPct,
  currency:              z.enum(['USD', 'EUR', 'MXN', 'CLP', 'COP', 'ARS', 'BRL', 'GBP']),
  content_guidelines:    z.string().max(2000).optional(),
  social_tags:           z.array(z.string()).optional(),
  deliverable_templates: z.array(z.object({
    type: z.string(), quantity: z.number().min(1).default(1),
    description: z.string().optional(), due_date: z.string().optional(),
  })).optional(),
  approval_required:     z.boolean(),
  brand_id:              z.string().optional(),
})

type FormValues = z.infer<typeof schema>

const CAMPAIGN_TYPES = [
  { value: 'sponsored_post',   label: 'Sponsored Post' },
  { value: 'ambassador',       label: 'Embajador' },
  { value: 'ugc',              label: 'UGC' },
  { value: 'event_appearance', label: 'Evento' },
  { value: 'product_seeding',  label: 'Product Seeding' },
  { value: 'live',             label: 'Live / Streaming' },
  { value: 'commission',       label: 'Por Comisión' },
] as const

const PLATFORMS = ['instagram', 'tiktok', 'youtube', 'twitter', 'facebook', 'linkedin'] as const

const CURRENCIES = [
  { value: 'USD', label: 'USD' }, { value: 'EUR', label: 'EUR' },
  { value: 'MXN', label: 'MXN' }, { value: 'CLP', label: 'CLP' },
  { value: 'COP', label: 'COP' }, { value: 'ARS', label: 'ARS' },
  { value: 'BRL', label: 'BRL' }, { value: 'GBP', label: 'GBP' },
]


// ── BrandSelector ─────────────────────────────────────────────────────────────
function BrandSelector({ register }: { register: import('react-hook-form').UseFormRegister<FormValues> }) {
  const [brands, setBrands] = useState<Array<{ id: string; name: string }>>([])
  useEffect(() => {
    fetch('/api/brands').then(r => r.json()).then(j => setBrands(j.data ?? [])).catch(() => {})
  }, [])
  if (!brands.length) return null
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">
        Marca <span className="text-gray-400 text-xs">(opcional)</span>
      </label>
      <select {...register('brand_id')} className="input-base w-full">
        <option value="">Sin marca asignada</option>
        {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
    </div>
  )
}

export function CampaignEditForm({ id }: { id: string }) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)

  const { data: res, isLoading, error } = useCampaignDetail(id)
  const patchCampaign = usePatchCampaign(id)

  const { register, control, handleSubmit, reset, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      currency: 'CLP',
      approval_required: true,
      platforms: [],
      social_tags: ['@influencers.snc'],
      deliverable_templates: [],
      brand_id:              '',
    },
  })

  // Populate form once data loads
  useEffect(() => {
    if (res?.data) {
      const c = res.data as unknown as Record<string, unknown>
      reset({
        name:                  c.name as string,
        description:           (c.description as string) ?? '',
        type:                  c.type as FormValues['type'],
        platforms:             (c.platforms ?? []) as string[],
        start_date:            (c.start_date as string) ?? '',
        end_date:              (c.end_date as string) ?? '',
        budget_total:          (c.budget_total as number) ?? 0,
        commission_rate:       (c.commission_rate as number) ?? undefined,
        currency:              (c.currency as FormValues['currency']) ?? 'CLP',
        content_guidelines:    (c.content_guidelines as string) ?? '',
        social_tags:           (c.social_tags as string[]) ?? ['@influencers.snc'],
        deliverable_templates: (c.deliverable_templates as FormValues['deliverable_templates']) ?? [],
        brand_id:              (c.brand_id as string) ?? '',
        approval_required:     c.approval_required as boolean,
      })
    }
  }, [res, reset])

  async function onSubmit(data: FormValues) {
    setSaving(true)
    try {
      await patchCampaign.mutateAsync({
        name:                  data.name.trim(),
        description:           data.description ?? null,
        type:                  data.type,
        platforms:             data.platforms,
        start_date:            data.start_date || null,
        end_date:              data.end_date || null,
        budget_total:          data.budget_total ?? 0,
        commission_rate:       data.type === 'commission' ? (data.commission_rate ?? null) : null,
        currency:              data.currency,
        content_guidelines:    data.content_guidelines ?? null,
        social_tags:           data.social_tags ?? [],
        deliverable_templates: data.deliverable_templates ?? [],
        brand_id:              data.brand_id || null,
        approval_required:     data.approval_required,
      })
      toast.success('Campaña actualizada')
      router.push(`/admin-campaigns/${id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar')
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
        <p className="text-gray-500 font-medium">Campaña no encontrada</p>
        <Link href="/admin-campaigns" className="mt-4 inline-block text-sm text-violet-600 hover:underline">
          Volver a campañas
        </Link>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href={`/admin-campaigns/${id}`}
          className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-500">
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Editar campaña</h1>
          <p className="text-sm text-gray-400">{res.data.name}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <div className="card p-6 space-y-5">
          {/* Nombre */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Nombre <span className="text-red-500">*</span>
            </label>
            <input {...register('name')} className="input-base w-full" />
            {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name.message}</p>}
          </div>

          {/* Descripción */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Descripción</label>
            <textarea {...register('description')} rows={3} className="input-base w-full resize-none" />
          </div>

          {/* Tipo */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Tipo <span className="text-red-500">*</span>
            </label>
            <Controller control={control} name="type" render={({ field }) => (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {CAMPAIGN_TYPES.map(t => (
                  <button key={t.value} type="button" onClick={() => field.onChange(t.value)}
                    className={cn(
                      'text-left px-3 py-2 rounded-lg border-2 text-sm font-medium transition-all',
                      field.value === t.value ? 'border-violet-500 bg-violet-50 text-violet-700' : 'border-gray-200 hover:border-gray-300'
                    )}>
                    {t.label}
                  </button>
                ))}
              </div>
            )} />
            {errors.type && <p className="text-xs text-red-500 mt-1">{errors.type.message}</p>}
          </div>

          {/* Plataformas */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Plataformas <span className="text-red-500">*</span>
            </label>
            <Controller control={control} name="platforms" render={({ field }) => (
              <div className="flex flex-wrap gap-2">
                {PLATFORMS.map(p => {
                  const active = field.value?.includes(p)
                  return (
                    <button key={p} type="button"
                      onClick={() => {
                        const next = active ? field.value.filter((v: string) => v !== p) : [...(field.value ?? []), p]
                        field.onChange(next)
                      }}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-medium transition-all',
                        active ? 'border-violet-500 bg-violet-50 text-violet-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      )}>
                      <span>{PLATFORM_ICONS[p]}</span>
                      {PLATFORM_LABELS[p] ?? p}
                    </button>
                  )
                })}
              </div>
            )} />
            {errors.platforms && <p className="text-xs text-red-500 mt-1">{errors.platforms.message}</p>}
          </div>

          {/* Fechas */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Fecha inicio</label>
              <input type="date" {...register('start_date')} className="input-base w-full" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Fecha fin</label>
              <input type="date" {...register('end_date')} className="input-base w-full" />
            </div>
          </div>

          {/* Budget */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Budget total</label>
              <input type="number" step="1000" min="0"
                {...register('budget_total', { valueAsNumber: true })}
                className="input-base w-full" placeholder="0" />
              <p className="text-xs text-gray-400 mt-1">Ingresa 0 para canje o sin presupuesto</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Moneda</label>
              <select {...register('currency')} className="input-base w-full">
                {CURRENCIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
          </div>

          {/* Comisión (solo si tipo = commission) */}
          <Controller control={control} name="type" render={({ field }) =>
            field.value === 'commission' ? (
              <div className="p-4 rounded-xl border-2 border-violet-200 bg-violet-50">
                <label className="block text-sm font-semibold text-violet-800 mb-1.5">💰 Comisión por ventas (%)</label>
                <input type="number" step="0.5" min="0" max="100"
                  {...register('commission_rate', { valueAsNumber: true })}
                  className="input-base w-full" placeholder="Ej. 10" />
              </div>
            ) : <></>
          } />

          {/* Tags sociales */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Tags obligatorios en publicaciones</label>
            <Controller control={control} name="social_tags" render={({ field }) => (
              <div>
                <div className="flex gap-2 mb-2">
                  <input className="input-base flex-1" placeholder="@influencers.snc o @marca"
                    id="stag-input"
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        const inp = (e.target as HTMLInputElement).value.trim()
                        if (inp && !(field.value ?? []).includes(inp)) {
                          field.onChange([...(field.value ?? []), inp]);
                          (e.target as HTMLInputElement).value = ''
                        }
                      }
                    }} />
                  <button type="button" className="px-3 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors"
                    onClick={() => {
                      const inp = (document.getElementById('stag-input') as HTMLInputElement)
                      const val = inp?.value.trim()
                      if (val && !(field.value ?? []).includes(val)) {
                        field.onChange([...(field.value ?? []), val])
                        inp.value = ''
                      }
                    }}>+</button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(field.value ?? []).map((tag: string) => (
                    <span key={tag} className="flex items-center gap-1 px-2 py-0.5 bg-violet-100 text-violet-700 text-xs font-medium rounded-full">
                      {tag}
                      <button type="button" onClick={() => field.onChange((field.value ?? []).filter((t: string) => t !== tag))} className="hover:text-red-500">×</button>
                    </span>
                  ))}
                </div>
              </div>
            )} />
          </div>

          {/* Deliverable templates */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Deliverables requeridos</label>
            <BrandSelector register={register} />

            <Controller control={control} name="deliverable_templates" render={({ field }) => (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {DELIVERABLE_TYPES_EDIT.map(dt => {
                    const active = (field.value ?? []).some((d: {type: string}) => d.type === dt.value)
                    return (
                      <button key={dt.value} type="button"
                        onClick={() => {
                          if (active) field.onChange((field.value ?? []).filter((d: {type:string}) => d.type !== dt.value))
                          else field.onChange([...(field.value ?? []), { type: dt.value, quantity: 1, description: '' }])
                        }}
                        className={cn(
                          'flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-medium transition-all',
                          active ? 'border-violet-500 bg-violet-50 text-violet-700' : 'border-gray-200 text-gray-600 hover:border-violet-300'
                        )}>
                        {dt.emoji} {dt.label}
                      </button>
                    )
                  })}
                </div>
                {(field.value ?? []).length > 0 && (
                  <div className="space-y-2">
                    {(field.value ?? []).map((d: {type:string;quantity:number;description?:string;due_date?:string}) => {
                      const dt = DELIVERABLE_TYPES_EDIT.find(t => t.value === d.type)
                      return (
                        <div key={d.type} className="p-3 rounded-xl border border-violet-100 bg-violet-50/50 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-semibold text-violet-800">{dt?.emoji} {dt?.label}</span>
                            <button type="button"
                              onClick={() => field.onChange((field.value ?? []).filter((x: {type:string}) => x.type !== d.type))}
                              className="text-gray-400 hover:text-red-500 text-xs">✕ Quitar</button>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-xs text-gray-500 mb-1 block">Cantidad</label>
                              <input type="number" min="1" value={d.quantity}
                                onChange={e => field.onChange((field.value ?? []).map((x: {type:string}) => x.type === d.type ? {...x, quantity: parseInt(e.target.value)||1} : x))}
                                className="input-base w-full py-1.5 text-sm" />
                            </div>
                            <div>
                              <label className="text-xs text-gray-500 mb-1 block">Fecha límite</label>
                              <input type="date" value={d.due_date ?? ''}
                                onChange={e => field.onChange((field.value ?? []).map((x: {type:string}) => x.type === d.type ? {...x, due_date: e.target.value} : x))}
                                className="input-base w-full py-1.5 text-sm" />
                            </div>
                          </div>
                          <input type="text" value={d.description ?? ''}
                            onChange={e => field.onChange((field.value ?? []).map((x: {type:string}) => x.type === d.type ? {...x, description: e.target.value} : x))}
                            placeholder="Instrucciones específicas"
                            className="input-base w-full py-1.5 text-sm" />
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )} />
          </div>

          {/* Guía de contenido */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Guía de contenido</label>
            <textarea {...register('content_guidelines')} rows={4} className="input-base w-full resize-none" />
          </div>

          {/* Aprobación */}
          <div className="flex items-center gap-3 p-4 rounded-xl border border-gray-200 bg-gray-50">
            <Controller control={control} name="approval_required" render={({ field }) => (
              <button type="button" role="switch" aria-checked={field.value}
                onClick={() => field.onChange(!field.value)}
                className={cn(
                  'relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0',
                  field.value ? 'bg-violet-600' : 'bg-gray-300'
                )}>
                <span className={cn(
                  'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
                  field.value ? 'translate-x-4' : 'translate-x-0.5'
                )} />
              </button>
            )} />
            <div>
              <div className="text-sm font-medium text-gray-800">Requerir aprobación de contenido</div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-between">
          <Link href={`/admin-campaigns/${id}`}
            className="px-4 py-2.5 text-sm font-medium text-gray-600 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors">
            Cancelar
          </Link>
          <button type="submit" disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700 disabled:opacity-60 transition-colors">
            {saving ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Guardando…</>
            ) : (
              <><Save className="h-4 w-4" /> Guardar cambios</>
            )}
          </button>
        </div>
      </form>
    </div>
  )
}
