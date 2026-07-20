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
import { BrandSelector } from '@/components/campaigns/BrandSelector'
import { PlanUpgradeWall } from '@/components/plan/PlanUpgradeWall'
import { getPlanLimits, getPlanTier } from '@/lib/plan-limits'

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
  description: z.string().max(3000).optional(),
  due_date:    z.string().optional(),
  scheduled_at: z.string().optional(),
  items: z.array(z.object({
    description: z.string().max(3000).optional(),
    due_date: z.string().optional(),
    scheduled_at: z.string().optional(),
  })).optional(),
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
  visibility: z.enum(['private', 'open']).default('private'),
  address: z.string().max(300).optional(),
  application_questions: z.array(z.string().min(1)).optional(),
  application_deadline: z.string().optional(),
  max_influencers: z.preprocess(
    v => (v === '' || (typeof v === 'number' && isNaN(v))) ? undefined : v,
    z.number().int().min(1, 'Debe haber al menos 1 cupo').optional()
  ),
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

// ── Preguntas de postulación (opcional, solo campañas públicas) ───────────────
// Pedido de Pri 2026-07-12: la marca puede agregar preguntas para que las
// influencers respondan al postular. Es opcional — si no se agrega ninguna,
// postular sigue siendo igual que antes. Si se agrega al menos una, responder
// pasa a ser obligatorio del lado influencer (ver /apply route).
function QuestionsInput({ value = [], onChange }: { value?: string[]; onChange: (v: string[]) => void }) {
  const [input, setInput] = useState('')
  function add() {
    const q = input.trim()
    if (q) onChange([...value, q])
    setInput('')
  }
  return (
    <div>
      <div className="flex gap-2 mb-2">
        <input
          className="input-base flex-1"
          placeholder="Ej. ¿Por qué quieres participar en esta campaña?"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
        />
        <button type="button" onClick={add}
          className="px-3 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 transition-colors">+</button>
      </div>
      <div className="space-y-1.5">
        {value.map((q, i) => (
          <div key={i} className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg">
            <span className="flex-1 text-sm text-gray-700">{q}</span>
            <button type="button" onClick={() => onChange(value.filter((_, idx) => idx !== i))} className="text-gray-400 hover:text-red-500 transition-colors">×</button>
          </div>
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
function Step1({ register, control, errors, planGating = false, canOpen = true }: StepProps & { planGating?: boolean; canOpen?: boolean }) {
  // En Basic, la primera campaña pública está incluida. Las siguientes requieren Growth.
  const openLocked = planGating && !canOpen
  const watchedVisibility = useWatch({ control, name: 'visibility' })
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

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Visibilidad</label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex items-start gap-3 p-4 rounded-xl border border-gray-200 cursor-pointer hover:border-violet-300 transition-colors">
            <input type="radio" value="private" {...register('visibility')} className="mt-1" />
            <div>
              <div className="text-sm font-semibold text-gray-900">Privada</div>
              <div className="text-xs text-gray-500 mt-0.5">Solo influencers invitadas o asignadas.</div>
            </div>
          </label>

          <label className={cn(
            'flex items-start gap-3 p-4 rounded-xl border transition-colors relative',
            openLocked
              ? 'border-gray-100 bg-gray-50 cursor-not-allowed opacity-70'
              : 'border-gray-200 cursor-pointer hover:border-violet-300'
          )}>
            <input type="radio" value="open" {...register('visibility')} className="mt-1" disabled={openLocked} />
            <div>
              <div className="text-sm font-semibold text-gray-900">Pública</div>
              <div className="text-xs text-gray-500 mt-0.5">Las influencers pueden postular desde su portal.</div>
            </div>
            {openLocked && (
              <span className="absolute top-2 right-2 text-[10px] font-bold text-violet-600 bg-violet-100 px-1.5 py-0.5 rounded-full">Growth</span>
            )}
          </label>
        </div>
      </div>

      {/* Preguntas de postulación — opcional en cualquier visibilidad. Pública:
          la influencer las responde para postular. Privada: las responde para
          aceptar la invitación (pedido de Pri 2026-07-12, mismo mecanismo,
          reutiliza application_questions/application_answers). */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          Preguntas {watchedVisibility === 'open' ? 'de postulación' : 'para aceptar la invitación'} <span className="text-gray-400 text-xs">(opcional)</span>
        </label>
        <p className="text-xs text-gray-400 mb-2">
          {watchedVisibility === 'open'
            ? 'Si agregas preguntas, la influencer deberá responderlas para poder postular.'
            : 'Si agregas preguntas, la influencer deberá responderlas antes de poder aceptar la invitación.'}
        </p>
        <Controller
          control={control}
          name="application_questions"
          render={({ field }) => (
            <QuestionsInput value={field.value ?? []} onChange={field.onChange} />
          )}
        />
      </div>
    </div>
  )
}

// ── Step 2 — Budget & Fechas ──────────────────────────────────────────────────
function Step2({ register, control, errors, portal = 'admin' }: StepProps & { portal?: 'admin' | 'brand' }) {
  const watchedType = (control as unknown as { _formValues: { type: string } })._formValues?.type
  const isCommission = watchedType === 'commission'
  const visibility = useWatch({ control, name: 'visibility' })
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

      {visibility === 'open' && (
        <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 space-y-3">
          <div>
            <p className="text-sm font-semibold text-violet-900">Postulaciones y cupos</p>
            <p className="text-xs text-violet-600 mt-0.5">La campaña mostrará “Cupos limitados” y cerrará automáticamente en la fecha indicada.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-violet-800 mb-1">Fecha y hora límite</label>
              <input type="datetime-local" {...register('application_deadline')} className="input-base w-full" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-violet-800 mb-1">Cantidad de cupos</label>
              <input type="number" min="1" step="1" {...register('max_influencers', { valueAsNumber: true })}
                className="input-base w-full" placeholder="Ej. 20" />
              {errors.max_influencers && <p className="text-xs text-red-500 mt-1">{errors.max_influencers.message}</p>}
            </div>
          </div>
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          Dirección / ubicación <span className="text-gray-400 text-xs">(opcional)</span>
        </label>
        <input {...register('address')} className="input-base w-full"
          placeholder="Dónde se realizará (evento, activación, tienda…)" />
      </div>

      {portal === 'admin' && (
        <Controller control={control} name="brand_id" render={({ field }) => (
          <BrandSelector value={field.value ?? ''} onChange={field.onChange} />
        )} />
      )}

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
interface CampaignFormProps {
  apiEndpoint?: string
  redirectBase?: string
  portal?: 'admin' | 'brand'
  /** Activa gating por plan (portal marca): límite de campañas + visibilidad Pro. */
  planGating?: boolean
}

export function CampaignForm({
  apiEndpoint = '/api/campaigns',
  redirectBase = '/admin-campaigns',
  portal = 'admin',
  planGating = false,
}: CampaignFormProps = {}) {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)
  const [draftSaving, setDraftSaving] = useState(false)
  const [campaignId, setCampaignId] = useState<string | null>(null)
  const [draftSavedAt, setDraftSavedAt] = useState<Date | null>(null)

  // ── Plan gating (solo cuando planGating=true, portal marca) ──────────────
  const [orgPlan, setOrgPlan] = useState<string>('free')
  const [atCampaignLimit, setAtCampaignLimit] = useState(false)
  const [hasUsedFirstPublicCampaign, setHasUsedFirstPublicCampaign] = useState(false)
  const [planReady, setPlanReady] = useState(!planGating)

  useEffect(() => {
    if (!planGating) return
    let cancelled = false
    async function checkPlan() {
      try {
        const [meRes, camsRes] = await Promise.all([
          fetch('/api/brand/me'),
          fetch('/api/brand/campaigns'),
        ])
        const meJson   = meRes.ok  ? await meRes.json()  : null
        const camsJson = camsRes.ok ? await camsRes.json() : null
        const plan   = meJson?.data?.org_plan ?? 'free'
        const limits = getPlanLimits(plan)
        const campaigns = camsJson?.data ?? []
        const active = campaigns.filter(
          (c: { status: string }) => c.status === 'active'
        ).length
        const openCampaigns = campaigns.filter(
          (c: { visibility?: string }) => c.visibility === 'open'
        ).length
        if (cancelled) return
        setOrgPlan(plan)
        setHasUsedFirstPublicCampaign(openCampaigns > 0)
        setAtCampaignLimit(active >= limits.max_active_campaigns)
      } catch {
        // No-fatal: el backend igual valida el límite al enviar.
      } finally {
        if (!cancelled) setPlanReady(true)
      }
    }
    checkPlan()
    return () => { cancelled = true }
  }, [planGating])

  const planLimits = getPlanLimits(orgPlan)
  const canOpen    = !planGating || planLimits.can_create_open_campaigns || !hasUsedFirstPublicCampaign
  const planTier   = getPlanTier(orgPlan)

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
      visibility: 'private',
      address: '',
      application_questions: [],
      application_deadline: '',
      max_influencers: undefined,
    },
  })

  // Must be after useForm so control is defined
  const campaignType = useWatch({ control, name: 'type' })

  // Arma el payload de campaña a partir de los valores actuales del form
  function buildPayload(data: FormValues) {
    return {
      ...data,
      start_date: data.start_date || null,
      end_date: data.end_date || null,
      budget_total: (data.budget_total !== undefined && !isNaN(data.budget_total as number)) ? data.budget_total : (data.type === 'commission' ? 0 : null),
      goals: data.goals ?? {},
      social_tags: data.social_tags ?? [],
      deliverable_templates: data.deliverable_templates ?? [],
      commission_rate: data.type === 'commission' ? (data.commission_rate ?? null) : null,
      brand_id: data.brand_id || null,
      visibility: data.visibility || 'private',
      address: data.address?.trim() || null,
      application_questions: data.application_questions ?? [],
      application_deadline: data.visibility === 'open' && data.application_deadline
        ? new Date(data.application_deadline).toISOString()
        : null,
      max_influencers: data.visibility === 'open' ? (data.max_influencers ?? null) : null,
    }
  }

  // Auto-guardado: crea (o actualiza) la campaña como 'draft' al avanzar de paso,
  // para que quede guardada aunque el usuario no llegue a "Crear campaña".
  async function saveDraft() {
    if (draftSaving) return
    setDraftSaving(true)
    try {
      const payload = buildPayload(getValues())
      if (!campaignId) {
        const res = await fetch(apiEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (res.ok) {
          const { data: campaign } = await res.json()
          setCampaignId(campaign.id)
          setDraftSavedAt(new Date())
        }
      } else {
        const res = await fetch(`${apiEndpoint}/${campaignId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (res.ok) setDraftSavedAt(new Date())
      }
    } catch {
      // Silencioso: el auto-guardado no debe bloquear el flujo del wizard.
    } finally {
      setDraftSaving(false)
    }
  }

  async function goNext() {
    const fieldsPerStep: Record<number, (keyof FormValues)[]> = {
      1: ['name', 'type', 'platforms'],
      2: [],
      3: [],
    }
    const ok = await trigger(fieldsPerStep[step] ?? [])
    if (!ok) return
    await saveDraft()
    setStep(s => s + 1)
  }

  async function onSubmit(data: FormValues) {
    setSaving(true)
    try {
      const payload = buildPayload(data)
      const isUpdate = !!campaignId
      const res = await fetch(isUpdate ? `${apiEndpoint}/${campaignId}` : apiEndpoint, {
        method: isUpdate ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const err = await res.json()
        // Límite de plan (portal marca): ofrecer acción de subir de plan.
        if (planGating && err.code && String(err.code).startsWith('PLAN_LIMIT_')) {
          toast.error(err.error, {
            action: { label: 'Subir de plan', onClick: () => router.push('/brand-settings/plan') },
          })
          return
        }
        throw new Error(err.error ?? 'Error al crear campaña')
      }
      const { data: campaign } = await res.json()
      toast.success('Campaña creada correctamente')
      router.push(`${redirectBase}/${campaign?.id ?? campaignId}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setSaving(false)
    }
  }

  // Mapea cada campo del schema al paso del wizard donde se edita, para poder
  // devolver al usuario al paso correcto cuando falla la validación final.
  const STEP_BY_FIELD: Record<string, number> = {
    name: 1, type: 1, platforms: 1, visibility: 1,
    start_date: 2, end_date: 2, budget_total: 2, commission_rate: 2, currency: 2, brand_id: 2, goals: 2,
    hashtags: 3, social_tags: 3, content_guidelines: 3, tags: 3, deliverable_templates: 3, approval_required: 3,
    application_questions: 1, application_deadline: 2, max_influencers: 2,
  }

  function onInvalid(formErrors: FieldErrors<FormValues>) {
    console.error('[CampaignForm] validación falló:', formErrors)
    const firstField = Object.keys(formErrors)[0]
    const firstError = firstField ? (formErrors as Record<string, { message?: string }>)[firstField] : undefined
    const targetStep = firstField ? (STEP_BY_FIELD[firstField] ?? 1) : 1
    setStep(targetStep)
    toast.error(
      firstError?.message
        ? `Paso ${targetStep}: ${firstError.message}`
        : 'Revisa los campos marcados en rojo antes de crear la campaña'
    )
  }

  // Muro de plan: solo portal marca al alcanzar el límite de campañas activas.
  if (planGating && planReady && atCampaignLimit) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <button type="button" onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700">
          <ChevronLeft className="h-4 w-4" /> Volver
        </button>
        <PlanUpgradeWall
          title="Límite de campañas alcanzado"
          description={`Tu plan ${planLimits.label} permite máximo ${planLimits.max_active_campaigns} campaña${planLimits.max_active_campaigns !== 1 ? 's' : ''} activa${planLimits.max_active_campaigns !== 1 ? 's' : ''}. Cancela una o sube de plan para crear más.`}
          currentPlan={orgPlan}
          requiredPlan={planTier === 'basic' ? 'growth' : 'pro'}
        />
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
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Nueva campaña</h1>
          <p className="text-sm text-gray-400">
            Paso {step} de {STEPS.length}
            {draftSavedAt && <span className="text-emerald-500"> · Borrador guardado ✓</span>}
          </p>
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
      <form onSubmit={handleSubmit(onSubmit, onInvalid)}>
        <div className="card p-6">
          {step === 1 && <Step1 register={register} control={control} errors={errors} planGating={planGating} canOpen={canOpen} />}
          {step === 2 && <Step2 register={register} control={control} errors={errors} portal={portal} />}
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
            <button type="button" onClick={goNext} disabled={draftSaving}
              className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors">
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
