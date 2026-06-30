'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useForm, useWatch, Controller, type UseFormRegister, type Control, type FieldErrors } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import {
  ChevronRight, ChevronLeft, Check,
  Target, Calendar, FileText, Sparkles,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { PLATFORM_ICONS, PLATFORM_LABELS } from '@/lib/utils'
import { DeliverableTemplateBuilder, DELIVERABLE_TYPES, CAMPAIGN_DELIVERABLE_DEFAULTS } from '@/components/campaigns/DeliverableTemplateBuilder'

// ── Helpers ───────────────────────────────────────────────────────────────────
const nanToUndef = z.preprocess(
  (v) => (typeof v === 'number' && isNaN(v)) ? undefined : v,
  z.number().min(0, 'Debe ser ≥ 0').optional()  // 0 es válido (campañas por comisión)
)
const nanToUndefClamped = z.preprocess(
  (v) => (typeof v === 'number' && isNaN(v)) ? undefined : v,
  z.number().min(0).max(100).optional()
)

// ── Schema ────────────────────────────────────────────────────────────────────
// DELIVERABLE_TYPES and CAMPAIGN_DELIVERABLE_DEFAULTS imported from DeliverableTemplateBuilder
type DeliverableTypeValue = typeof DELIVERABLE_TYPES[number]['value']

const deliverableSchema = z.object({
  type:        z.string(),
  quantity:    z.number().min(1).default(1),
  description: z.string().max(500).optional(),
  due_date:    z.string().optional(),
})

const schema = z.object({
  name: z.string().min(3, 'Mínimo 3 caracteres').max(120),
  description: z.string().max(500).optional(),
  type: z.enum(['sponsored_post', 'ambassador', 'ugc', 'event_appearance', 'product_seeding', 'live', 'commission']),
  platforms: z.array(z.string()).min(1, 'Selecciona al menos una plataforma'),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  budget_total: nanToUndef,
  commission_rate: nanToUndefClamped,
  currency: z.enum(['USD', 'EUR', 'MXN', 'CLP', 'COP', 'ARS', 'BRL', 'GBP']),
  goals: z.object({
    impressions:      nanToUndef,
    reach:            nanToUndef,
    engagement_rate:  nanToUndefClamped,
    clicks:           nanToUndef,
    conversions:      nanToUndef,
  }).optional(),
  hashtags: z.array(z.string()).optional(),
  social_tags: z.array(z.string()).optional(),
  content_guidelines: z.string().max(2000).optional(),
  approval_required: z.boolean(),
  tags: z.array(z.string()).optional(),
  deliverable_templates: z.array(deliverableSchema).optional(),
  brand_id: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

const CAMPAIGN_TYPES = [
  { value: 'sponsored_post',   label: 'Sponsored Post',   desc: 'Publicación patrocinada en redes' },
  { value: 'ambassador',       label: 'Embajador',         desc: 'Relación de largo plazo con la marca' },
  { value: 'ugc',              label: 'UGC',               desc: 'Contenido generado por usuarios' },
  { value: 'event_appearance', label: 'Evento',            desc: 'Aparición en eventos presenciales' },
  { value: 'product_seeding',  label: 'Product Seeding',   desc: 'Envío de producto para reseña' },
  { value: 'live',             label: 'Live / Streaming',  desc: 'Transmisión en vivo patrocinada' },
  { value: 'commission',       label: 'Por Comisión',      desc: 'Pago por % de ventas generadas' },
] as const

const PLATFORMS = ['instagram', 'tiktok', 'youtube', 'twitter', 'facebook', 'linkedin'] as const

const CURRENCIES = [
  { value: 'USD', label: 'USD — Dólar americano' },
  { value: 'EUR', label: 'EUR — Euro' },
  { value: 'MXN', label: 'MXN — Peso mexicano' },
  { value: 'CLP', label: 'CLP — Peso chileno' },
  { value: 'COP', label: 'COP — Peso colombiano' },
  { value: 'ARS', label: 'ARS — Peso argentino' },
  { value: 'BRL', label: 'BRL — Real brasileño' },
  { value: 'GBP', label: 'GBP — Libra esterlina' },
]

const STEPS = [
  { id: 1, label: 'Información', icon: Target },
  { id: 2, label: 'Budget',      icon: Calendar },
  { id: 3, label: 'Contenido',   icon: FileText },
  { id: 4, label: 'Confirmar',   icon: Sparkles },
]

// ── Hashtag input ─────────────────────────────────────────────────────────────
function HashtagInput({ value = [], onChange }: { value?: string[]; onChange: (v: string[]) => void }) {
  const [input, setInput] = useState('')
  function add() {
    const tag = input.trim().replace(/^#/, '')
    if (tag && !value.includes(`#${tag}`)) onChange([...value, `#${tag}`])
    setInput('')
  }
  return (
    <div>
      <div className="flex gap-2 mb-2">
        <input
          className="input-base flex-1"
          placeholder="#hashtag"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); add() } }}
        />
        <button type="button" onClick={add}
          className="px-3 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 transition-colors">+</button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {value.map(tag => (
          <span key={tag} className="flex items-center gap-1 px-2 py-0.5 bg-violet-100 text-violet-700 text-xs font-medium rounded-full">
            {tag}
            <button type="button" onClick={() => onChange(value.filter(t => t !== tag))} className="hover:text-red-500 transition-colors">×</button>
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Tag input ─────────────────────────────────────────────────────────────────
function TagInput({ value = [], onChange, placeholder = 'Agregar tag' }: { value?: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [input, setInput] = useState('')
  function add() {
    const tag = input.trim().toLowerCase()
    if (tag && !value.includes(tag)) onChange([...value, tag])
    setInput('')
  }
  return (
    <div>
      <div className="flex gap-2 mb-2">
        <input className="input-base flex-1" placeholder={placeholder}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
        />
        <button type="button" onClick={add}
          className="px-3 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors">+</button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {value.map(tag => (
          <span key={tag} className="flex items-center gap-1 px-2 py-0.5 bg-gray-100 text-gray-600 text-xs font-medium rounded-full">
            {tag}
            <button type="button" onClick={() => onChange(value.filter(t => t !== tag))} className="hover:text-red-500 transition-colors">×</button>
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Step props ────────────────────────────────────────────────────────────────
interface StepProps {
  register: UseFormRegister<FormValues>
  control: Control<FormValues>
  errors: FieldErrors<FormValues>
  setValue?: ReturnType<typeof useForm<FormValues>>['setValue']
  campaignType?: string
}

// ── Step 1 — Info (defined OUTSIDE CampaignForm to avoid remount on re-render)
function Step1({ register, control, errors }: StepProps) {
  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          Nombre de la campaña <span className="text-red-500">*</span>
        </label>
        <input
          {...register('name')}
          className="input-base w-full"
          placeholder="Ej. Nike Air Max — Verano 2026"
        />
        {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name.message}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          Descripción <span className="text-gray-400 text-xs">(opcional)</span>
        </label>
        <textarea
          {...register('description')}
          rows={3}
          className="input-base w-full resize-none"
          placeholder="Breve descripción de los objetivos de la campaña…"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-3">
          Tipo de campaña <span className="text-red-500">*</span>
        </label>
        <Controller
          control={control}
          name="type"
          render={({ field }) => (
            <div className="grid grid-cols-2 gap-3">
              {CAMPAIGN_TYPES.map(t => (
                <button key={t.value} type="button" onClick={() => field.onChange(t.value)}
                  className={cn(
                    'text-left p-3.5 rounded-xl border-2 transition-all',
                    field.value === t.value ? 'border-violet-500 bg-violet-50' : 'border-gray-200 hover:border-gray-300 bg-white'
                  )}>
                  <div className={cn('text-sm font-semibold', field.value === t.value ? 'text-violet-700' : 'text-gray-800')}>{t.label}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{t.desc}</div>
                </button>
              ))}
            </div>
          )}
        />
        {errors.type && <p className="text-xs text-red-500 mt-1">{errors.type.message}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-3">
          Plataformas <span className="text-red-500">*</span>
        </label>
        <Controller
          control={control}
          name="platforms"
          render={({ field }) => (
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
          )}
        />
        {errors.platforms && <p className="text-xs text-red-500 mt-1">{errors.platforms.message}</p>}
      </div>
    </div>
  )
}

// ── BrandSelector ────────────────────────────────────────────────────────────
function BrandSelector({ register }: { register: UseFormRegister<FormValues> }) {
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

// ── Step 2 — Budget & Fechas ──────────────────────────────────────────────────
function Step2({ register, control, errors }: StepProps) {
  const watchedType = (control as unknown as { _formValues: { type: string } })._formValues?.type
  const isCommission = watchedType === 'commission'
  return (
    <div className="space-y-6">
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

      <BrandSelector register={register} />

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Budget total</label>
          <input type="number" step="1000" min="0"
            {...register('budget_total', { valueAsNumber: true })}
            className="input-base w-full" placeholder="0" />
          <p className="text-xs text-gray-400 mt-1">Ingresa 0 si es canje o sin presupuesto definido</p>
          {errors.budget_total && <p className="text-xs text-red-500 mt-1">{errors.budget_total.message}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Moneda</label>
          <select {...register('currency')} className="input-base w-full">
            {CURRENCIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
      </div>

      <Controller control={control} name="type" render={({ field }) => (
        field.value === 'commission' ? (
          <div className="p-4 rounded-xl border-2 border-violet-200 bg-violet-50">
            <label className="block text-sm font-semibold text-violet-800 mb-1.5">
              💰 Comisión por ventas (%)
            </label>
            <input type="number" step="0.5" min="0" max="100"
              {...register('commission_rate', { valueAsNumber: true })}
              className="input-base w-full" placeholder="Ej. 10" />
            <p className="text-xs text-violet-600 mt-1">Porcentaje del total de ventas que recibirá cada influencer</p>
          </div>
        ) : <></>
      )} />

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-3">
          Metas <span className="text-gray-400 text-xs">(opcional)</span>
        </label>
        <div className="grid grid-cols-2 gap-4">
          {[
            { name: 'goals.impressions' as const, label: 'Impresiones',         placeholder: 'Ej. 1,000,000' },
            { name: 'goals.reach' as const,       label: 'Alcance (Reach)',      placeholder: 'Ej. 500,000' },
            { name: 'goals.clicks' as const,      label: 'Clicks',               placeholder: 'Ej. 10,000' },
            { name: 'goals.conversions' as const, label: 'Conversiones',         placeholder: 'Ej. 500' },
          ].map(f => (
            <div key={f.name}>
              <label className="block text-xs text-gray-500 mb-1">{f.label}</label>
              <input type="number" {...register(f.name, { valueAsNumber: true })}
                className="input-base w-full" placeholder={f.placeholder} />
            </div>
          ))}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Engagement rate (%)</label>
            <input type="number" step="0.1" min="0" max="100"
              {...register('goals.engagement_rate', { valueAsNumber: true })}
              className="input-base w-full" placeholder="Ej. 5.0" />
          </div>
        </div>
      </div>
    </div>
  )
}

// DeliverableTemplateBuilder now imported from @/components/campaigns/DeliverableTemplateBuilder

// ── Step 3 — Contenido ────────────────────────────────────────────────────────
function Step3({ register, control, setValue, campaignType }: StepProps) {
  const currentTemplates = useWatch({ control, name: 'deliverable_templates' }) ?? []
  const suggested = campaignType ? (CAMPAIGN_DELIVERABLE_DEFAULTS[campaignType] ?? []) : []
  const typeLabel = CAMPAIGN_TYPES.find(t => t.value === campaignType)?.label

  // Auto-fill on first entry to this step (when templates still empty)
  useEffect(() => {
    if (suggested.length > 0 && currentTemplates.length === 0 && setValue) {
      setValue('deliverable_templates', suggested.map(s => ({ ...s, due_date: '' })))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          Deliverables requeridos
        </label>

        {/* Banner de sugeridos */}
        {suggested.length > 0 && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-violet-50 border border-violet-100 mb-3">
            <span className="text-violet-500 mt-0.5">✨</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-violet-700">
                Deliverables sugeridos para campaña de tipo <span className="font-bold">{typeLabel}</span>
              </p>
              <p className="text-xs text-violet-500 mt-0.5">Pre-cargados automáticamente — puedes editarlos o agregar más.</p>
            </div>
            {currentTemplates.length === 0 && (
              <button
                type="button"
                onClick={() => setValue?.('deliverable_templates', suggested.map(s => ({ ...s, due_date: '' })))}
                className="text-xs text-violet-600 font-semibold hover:underline whitespace-nowrap"
              >
                Restaurar
              </button>
            )}
          </div>
        )}

        <p className="text-xs text-gray-400 mb-2">Selecciona los tipos y agrega detalles. Se asignarán a cada influencer en la campaña.</p>
        <Controller control={control} name="deliverable_templates"
          render={({ field }) => (
            <DeliverableTemplateBuilder value={field.value} onChange={field.onChange} />
          )} />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          Tags obligatorios en publicaciones
        </label>
        <p className="text-xs text-gray-400 mb-2">Se muestran al influencer como requisito en cada post/historia</p>
        <Controller control={control} name="social_tags"
          render={({ field }) => (
            <TagInput value={field.value} onChange={field.onChange} placeholder="@influencers.snc o @marca" />
          )} />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">Hashtags</label>
        <Controller control={control} name="hashtags"
          render={({ field }) => <HashtagInput value={field.value} onChange={field.onChange} />} />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">Guía de contenido</label>
        <textarea {...register('content_guidelines')} rows={5}
          className="input-base w-full resize-none"
          placeholder="Instrucciones de estilo, qué incluir/excluir, tono de voz, colores, referencias de marca…" />
        <p className="text-xs text-gray-400 mt-1">Máx. 2000 caracteres. Se compartirá con los influencers.</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          Tags internos <span className="text-gray-400 text-xs">(opcional)</span>
        </label>
        <Controller control={control} name="tags"
          render={({ field }) => <TagInput value={field.value} onChange={field.onChange} placeholder="Ej. q2, verano, nike" />} />
      </div>

      {/* Visibility toggle */}
      <div className="flex items-center gap-3 p-4 rounded-xl border border-gray-200 bg-gray-50">
        <Controller control={control} name={"visibility" as never}
          render={({ field }) => (
            <button type="button" role="switch" aria-checked={field.value === 'public'}
              onClick={() => field.onChange(field.value === 'public' ? 'invite_only' : 'public')}
              className={cn('relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0', field.value === 'public' ? 'bg-violet-600' : 'bg-gray-300')}>
              <span className={cn('inline-block h-4 w-4 rounded-full bg-white shadow transition-transform', field.value === 'public' ? 'translate-x-4' : 'translate-x-0.5')} />
            </button>
          )} />
        <div>
          <div className="text-sm font-medium text-gray-800">Campaña pública 🌐</div>
          <div className="text-xs text-gray-400">Las influencers pueden postular desde su portal marketplace</div>
        </div>
      </div>

      <div className="flex items-center gap-3 p-4 rounded-xl border border-gray-200 bg-gray-50">
        <Controller control={control} name="approval_required"
          render={({ field }) => (
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
          <div className="text-xs text-gray-400">Los deliverables deben aprobarse antes de publicarse</div>
        </div>
      </div>
    </div>
  )
}

// ── Step 4 — Resumen ──────────────────────────────────────────────────────────
function Step4({ values }: { values: FormValues }) {
  const typeLabel = CAMPAIGN_TYPES.find(t => t.value === values.type)?.label ?? values.type
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">Revisa los datos antes de crear la campaña.</p>
      <div className="card divide-y divide-gray-100">
        {[
          ['Nombre',      values.name],
          ['Tipo',        typeLabel],
          ['Plataformas', values.platforms?.map(p => PLATFORM_ICONS[p]).join(' ') || '—'],
          ['Inicio',      values.start_date || '—'],
          ['Fin',         values.end_date || '—'],
          ['Budget',      (values.budget_total != null && !isNaN(values.budget_total)) ? `${values.budget_total.toLocaleString('es-CL')} ${values.currency}` : '—'],
          ['Hashtags',    values.hashtags?.join(', ') || '—'],
          ['Aprobación',  values.approval_required ? 'Requerida' : 'No requerida'],
        ].map(([label, val]) => (
          <div key={label as string} className="flex justify-between py-3 px-4 text-sm">
            <span className="text-gray-400 font-medium">{label}</span>
            <span className="text-gray-800 font-semibold text-right max-w-[60%]">{val}</span>
          </div>
        ))}
      </div>
      {values.content_guidelines && (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Guía de contenido</p>
          <p className="text-sm text-gray-700 bg-gray-50 rounded-xl p-4 whitespace-pre-wrap">{values.content_guidelines}</p>
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export function CampaignForm() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)

  const { register, control, handleSubmit, getValues, setValue, trigger, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      currency: 'CLP',
      approval_required: true,
      platforms: [],
      hashtags: [],
      social_tags: ['@influencers.snc'],
      tags: [],
      deliverable_templates: [],
      brand_id: '',
    },
  })

  // Must be after useForm so control is defined
  const campaignType = useWatch({ control, name: 'type' })

  async function goNext() {
    const fieldsPerStep: Record<number, (keyof FormValues)[]> = {
      1: ['name', 'type', 'platforms'],
      2: [],
      3: [],
    }
    const ok = await trigger(fieldsPerStep[step] ?? [])
    if (ok) setStep(s => s + 1)
  }

  async function onSubmit(data: FormValues) {
    setSaving(true)
    try {
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          start_date: data.start_date || null,
          end_date: data.end_date || null,
          budget_total: (data.budget_total !== undefined && !isNaN(data.budget_total as number)) ? data.budget_total : (data.type === 'commission' ? 0 : null),
          goals: data.goals ?? {},
          social_tags: data.social_tags ?? [],
          deliverable_templates: data.deliverable_templates ?? [],
          commission_rate: data.type === 'commission' ? (data.commission_rate ?? null) : null,
          brand_id: data.brand_id || null,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Error al crear campaña')
      }
      const { data: campaign } = await res.json()
      toast.success('Campaña creada correctamente')
      router.push(`/admin-campaigns/${campaign.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setSaving(false)
    }
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
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Nueva campaña</h1>
          <p className="text-sm text-gray-400">Paso {step} de {STEPS.length}</p>
        </div>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2">
        {STEPS.map((s, i) => {
          const Icon = s.icon
          const done   = step > s.id
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
              {i < STEPS.length - 1 && <div className={cn('h-px flex-1', done ? 'bg-emerald-300' : 'bg-gray-200')} />}
            </div>
          )
        })}
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit(onSubmit)}>
        <div className="card p-6">
          {step === 1 && <Step1 register={register} control={control} errors={errors} />}
          {step === 2 && <Step2 register={register} control={control} errors={errors} />}
          {step === 3 && <Step3 register={register} control={control} errors={errors} setValue={setValue} campaignType={campaignType} />}
          {step === 4 && <Step4 values={getValues()} />}
        </div>

        {/* Navigation */}
        <div className="flex justify-between mt-4">
          <button type="button" onClick={() => setStep(s => Math.max(1, s - 1))} disabled={step === 1}
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
                <><div className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />Creando…</>
              ) : (
                <><Sparkles className="h-4 w-4" /> Crear campaña</>
              )}
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
