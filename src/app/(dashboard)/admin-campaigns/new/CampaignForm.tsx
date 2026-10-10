'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useForm, useWatch, Controller, type UseFormRegister, type Control, type FieldErrors } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import {
  ChevronRight, ChevronLeft, Check,
  Target, Calendar, FileText, Sparkles, Plus, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { PLATFORM_ICONS, PLATFORM_LABELS } from '@/lib/utils'
import { DeliverableTemplateBuilder, DELIVERABLE_TYPES, CAMPAIGN_DELIVERABLE_DEFAULTS } from '@/components/campaigns/DeliverableTemplateBuilder'
import { CampaignLocationsEditor } from '@/components/locations/CampaignLocationsEditor'
import { savePendingCampaignLocations, type PendingCampaignLocation } from '@/hooks/useCampaignLocations'
import { BrandSelector } from '@/components/campaigns/BrandSelector'

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

const campaignBenefitSchema = z.object({
  benefit_type: z.enum(['product', 'experience', 'meal', 'ticket', 'gift_card', 'service', 'sales_commission', 'other']),
  description: z.string().min(1, 'Describe el beneficio').max(500),
  quantity: z.number().int().min(1).default(1),
  estimated_value: nanToUndef,
  commission_rate: nanToUndefClamped,
  currency: z.string().default('CLP'),
  activation_rule: z.enum(['deliverables_completed', 'sales_target', 'attendance', 'accepted', 'manual', 'raffle']),
  sales_target: z.number().int().min(1).optional(),
})

const schema = z.object({
  name: z.string().min(3, 'Mínimo 3 caracteres').max(120),
  description: z.string().max(3000).optional(),
  type: z.enum(['sponsored_post', 'ambassador', 'ugc', 'event_appearance', 'product_seeding', 'live', 'commission']),
  platforms: z.array(z.string()).optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  event_date: z.string().optional(),
  budget_total: nanToUndef,
  commission_rate: nanToUndefClamped,
  currency: z.enum(['USD', 'EUR', 'MXN', 'CLP', 'COP', 'ARS', 'BRL', 'GBP']),
  goals: z.object({ impressions: nanToUndef, reach: nanToUndef, engagement_rate: nanToUndefClamped, clicks: nanToUndef, conversions: nanToUndef }).optional(),
  hashtags: z.array(z.string()).optional(), social_tags: z.array(z.string()).optional(), approval_required: z.boolean(),
  approval_submission_url: z.string().optional(), reference_url: z.string().optional(), brief_url: z.string().optional(),
  collaborator_ids: z.array(z.string()).optional(), tags: z.array(z.string()).optional(),
  deliverable_templates: z.array(deliverableSchema).optional(), campaign_benefits: z.array(campaignBenefitSchema).optional(),
  brand_id: z.string().optional(),
  visibility: z.enum(['private', 'open']).default('open'),
  access_mode: z.enum(['public', 'private_pro', 'invitation']).default('public'),
  whatsapp_group_url: z.string().optional(), application_questions: z.array(z.string()).optional(),
  application_deadline: z.string().optional(), max_influencers: z.number().int().min(1).optional(),
})

type FormValues = z.infer<typeof schema>
type CampaignBenefitInput = z.infer<typeof campaignBenefitSchema>

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

const BENEFIT_TYPES = [
  ['ticket', 'Entrada / ticket'], ['product', 'Producto'], ['experience', 'Experiencia'],
  ['meal', 'Comida o degustación'], ['gift_card', 'Gift card'], ['service', 'Servicio'],
  ['sales_commission', 'Comisión por ventas'], ['other', 'Otro'],
] as const

const ACTIVATION_RULES = [
  ['deliverables_completed', 'Al completar los entregables'],
  ['sales_target', 'Al alcanzar una meta de ventas'],
  ['attendance', 'Al asistir al evento'],
  ['accepted', 'Al ser aceptada'],
  ['raffle', 'Por sorteo'],
  ['manual', 'Activación manual'],
] as const

const STEPS = [{ id: 1, label: 'Información', icon: Target }] as const

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

function CollaboratorSelector({ campaignId, value = [], onChange }: { campaignId: string; value?: string[]; onChange: (ids: string[]) => void }) {
  const [instagram, setInstagram] = useState('')
  const [busy, setBusy] = useState(false)
  async function add() {
    if (!instagram.trim()) return
    setBusy(true)
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/brands`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instagram, name: instagram.replace(/^@/, '') }) })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'No se pudo agregar la marca')
      if (!value.includes(json.data.brand_id)) onChange([...value, json.data.brand_id])
      setInstagram('')
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo agregar la marca') }
    finally { setBusy(false) }
  }
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">Marcas colaboradoras <span className="text-gray-400 text-xs">(opcional)</span></label>
      <p className="text-xs text-gray-400 mb-2">Agrega su Instagram para que las influencers sepan qué marca participa.</p>
      <div className="flex gap-2">
        <input value={instagram} onChange={e => setInstagram(e.target.value)} className="input-base" placeholder="@marca" />
        <button type="button" disabled={busy || !instagram.trim()} onClick={add} className="px-3 py-2 rounded-lg bg-violet-600 text-white text-sm font-semibold disabled:opacity-50">Agregar</button>
      </div>
      {value.length > 0 && <p className="text-xs text-emerald-600 mt-2">{value.length} marca{value.length === 1 ? '' : 's'} colaboradora{value.length === 1 ? '' : 's'} agregada{value.length === 1 ? '' : 's'}.</p>}
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
function Step1({ register, control, errors, eventDays, setEventDays, campaignId, pendingLocations, setPendingLocations, setRemovedEventBookingIds, portal = 'admin', campaignType }: StepProps & {
  eventDays: Array<{ id?: string; starts_at: string; ends_at: string }>
  setEventDays: React.Dispatch<React.SetStateAction<Array<{ id?: string; starts_at: string; ends_at: string }>>>
  campaignId: string | null
  pendingLocations: PendingCampaignLocation[]
  setPendingLocations: (value: PendingCampaignLocation[]) => void
  setRemovedEventBookingIds: React.Dispatch<React.SetStateAction<string[]>>
  portal?: 'admin' | 'brand'
}) {
  const brandId = useWatch({ control, name: 'brand_id' })
  const addDay = () => setEventDays(days => [...days, { starts_at: '', ends_at: '' }])
  const updateDay = (index: number, key: 'starts_at' | 'ends_at', value: string) =>
    setEventDays(days => days.map((day, i) => i === index ? { ...day, [key]: value } : day))
  const removeDay = (index: number) => setEventDays(days => {
    const day = days[index]
    if (day?.id) setRemovedEventBookingIds(ids => [...ids, day.id!])
    return days.filter((_, i) => i !== index)
  })

  return (
    <div className="space-y-2.5">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Nombre de la campaña <span className="text-red-500">*</span></label>
        <input {...register('name')} className="input-base w-full !py-2" placeholder="Ej. Evento SCENCE — Noviembre 2026" />
        {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name.message}</p>}
      </div>

      <div className="rounded-xl border border-gray-200 bg-gray-50 p-2.5 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-gray-900">Lugar y fechas</p>
            <p className="text-[11px] text-gray-500">Solo la comuna y el país se muestran al postular. El lugar y la dirección se muestran al aceptar.</p>
          </div>
          <span className="text-[11px] text-gray-400 shrink-0">Información del evento</span>
        </div>

        <CampaignLocationsEditor
          campaignId={campaignId}
          portal={portal}
          brandId={portal === 'admin' ? (brandId || null) : null}
          pending={pendingLocations}
          onPendingChange={setPendingLocations}
        />

        <div className="border-t border-gray-200 pt-3">
          <div className="flex items-center justify-between gap-3 mb-2">
            <p className="text-xs font-semibold text-gray-700">Días y horarios</p>
            <button type="button" onClick={addDay} className="inline-flex items-center gap-1 rounded-md border border-violet-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-violet-700 hover:bg-violet-50"><Plus className="h-3 w-3" /> Agregar día</button>
          </div>
          <div className="space-y-1.5">
            {(eventDays.length ? eventDays : [{ starts_at: '', ends_at: '' }]).map((day, index) => {
              const date = day.starts_at?.slice(0, 10) ?? ''
              const startTime = day.starts_at?.slice(11, 16) ?? ''
              const endTime = day.ends_at?.slice(11, 16) ?? ''
              return <div key={day.id ?? index} className="grid grid-cols-[1.25fr_1fr_1fr_auto] gap-1.5 items-end rounded-lg bg-white px-2.5 py-2 border border-gray-200">
                <div><label className="block text-[10px] font-medium text-gray-500 mb-0.5">Fecha</label><input type="date" value={date} onChange={e => { const d=e.target.value; updateDay(index,'starts_at',d ? `${d}T${startTime || '00:00'}` : ''); updateDay(index,'ends_at',d ? `${d}T${endTime || '00:00'}` : '') }} className="input-base w-full !py-1.5 text-sm" /></div>
                <div><label className="block text-[10px] font-medium text-gray-500 mb-0.5">Desde</label><input type="time" value={startTime} onChange={e => date && updateDay(index,'starts_at',`${date}T${e.target.value}`)} className="input-base w-full !py-1.5 text-sm" /></div>
                <div><label className="block text-[10px] font-medium text-gray-500 mb-0.5">Hasta</label><input type="time" value={endTime} onChange={e => date && updateDay(index,'ends_at',`${date}T${e.target.value}`)} className="input-base w-full !py-1.5 text-sm" /></div>
                <button type="button" onClick={() => removeDay(index)} disabled={eventDays.length <= 1} className="mb-0.5 rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-30" title="Quitar día"><X className="h-3.5 w-3.5" /></button>
              </div>
            })}
          </div>
        </div>
      </div>

      {portal === 'admin' && <Controller control={control} name="brand_id" render={({ field }) => <BrandSelector value={field.value ?? ''} onChange={field.onChange} />} />}

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Descripción</label>
        <textarea {...register('description')} rows={2} maxLength={3000} className="input-base w-full resize-none !py-2" placeholder="Describe brevemente la campaña…" />
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-3 space-y-2">
        <div>
          <p className="text-sm font-semibold text-gray-900">Entregables</p>
          <p className="text-[11px] text-gray-500">Se definen una sola vez para la campaña y se asignan automáticamente a todas las influencers aceptadas. No necesitas elegir una influencer.</p>
        </div>
        <Controller
          control={control}
          name="deliverable_templates"
          render={({ field }) => (
            <DeliverableTemplateBuilder
              value={field.value ?? []}
              onChange={field.onChange}
              campaignType={campaignType}
              showSuggestions={false}
              compact
            />
          )}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">Cómo participarán las influencers <span className="text-red-500">*</span></label>
        <Controller control={control} name="access_mode" render={({ field }) => (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {[
              { value: 'public', title: 'Pública', desc: 'Cualquier influencer puede postular.' },
              { value: 'private_pro', title: 'Privada (Pro)', desc: 'Solo influencers Pro pueden postular.' },
              { value: 'invitation', title: 'Por invitación', desc: 'Solo influencers invitadas pueden participar.' },
            ].map(option => <button key={option.value} type="button" onClick={() => field.onChange(option.value)} className={cn('text-left rounded-lg border p-2.5 transition-all', field.value === option.value ? 'border-violet-500 bg-violet-50 ring-1 ring-violet-500' : 'border-gray-200 bg-white hover:border-gray-300')}><p className="text-sm font-semibold text-gray-900">{option.title}</p><p className="text-[11px] text-gray-500 mt-0.5 leading-snug">{option.desc}</p></button>)}
          </div>
        )} />
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
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
interface CampaignFormProps {
  apiEndpoint?: string
  redirectBase?: string
  portal?: 'admin' | 'brand'
}

export function CampaignForm({
  apiEndpoint = '/api/campaigns',
  redirectBase = '/admin-campaigns',
  portal = 'admin',
}: CampaignFormProps = {}) {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)
  const [draftSaving, setDraftSaving] = useState(false)
  const [campaignId, setCampaignId] = useState<string | null>(null)
  const [draftSavedAt, setDraftSavedAt] = useState<Date | null>(null)
  const [eventDays, setEventDays] = useState<Array<{ id?: string; starts_at: string; ends_at: string }>>([{ starts_at: '', ends_at: '' }])
  const [removedEventBookingIds, setRemovedEventBookingIds] = useState<string[]>([])
  const [pendingLocations, setPendingLocations] = useState<PendingCampaignLocation[]>([])

  const { register, control, handleSubmit, getValues, setValue, trigger, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      type: 'event_appearance',
      currency: 'CLP',
      approval_required: true,
      platforms: [],
      hashtags: [], social_tags: ['@influencers.snc'], tags: [], deliverable_templates: [], campaign_benefits: [],
      brand_id: '', visibility: 'open', access_mode: 'public', whatsapp_group_url: '', application_questions: [],
      application_deadline: '', max_influencers: undefined, event_date: '', approval_submission_url: '', reference_url: '',
      brief_url: '', collaborator_ids: [],
    },
  })

  // Must be after useForm so control is defined
  const campaignType = useWatch({ control, name: 'type' })
  // A diferencia del autosave anterior (solo al avanzar), esta firma observa
  // todas las ediciones del borrador, incluida la guía de contenido.
  const autosaveSignature = JSON.stringify({ form: useWatch({ control }), eventDays, pendingLocations })

  useEffect(() => {
    if (portal !== 'brand') return
    fetch('/api/brand/me').then(r => r.ok ? r.json() : null).then(json => {
      const raw = String(json?.data?.instagram ?? '').trim()
      const handle = raw.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').replace(/\/.*/, '')
      if (!handle) return
      const tag = `@${handle}`.toLowerCase()
      const current = getValues('social_tags') ?? []
      setValue('social_tags', Array.from(new Set(['@influencers.snc', tag, ...current])))
    }).catch(() => undefined)
  }, [portal, getValues, setValue])

  // Arma el payload de campaña a partir de los valores actuales del form
  function buildPayload(data: FormValues) {
    const {
      event_date,
      access_mode,
      reference_url,
      approval_submission_url,
      collaborator_ids: _collaboratorIds,
      ...campaignFields
    } = data
    return {
      ...campaignFields,
      start_date: eventDays.find(day => day.starts_at)?.starts_at.slice(0, 10) || data.start_date || null,
      end_date: [...eventDays].reverse().find(day => day.starts_at)?.starts_at.slice(0, 10) || data.end_date || null,
      budget_total: (data.budget_total !== undefined && !isNaN(data.budget_total as number)) ? data.budget_total : (data.type === 'commission' ? 0 : null),
      goals: data.goals ?? {},
      social_tags: data.social_tags ?? [],
      deliverable_templates: data.deliverable_templates ?? [],
      campaign_benefits: data.campaign_benefits ?? [],
      commission_rate: data.type === 'commission' ? (data.commission_rate ?? null) : null,
      brand_id: data.brand_id || null,
      visibility: data.access_mode === 'public' ? 'open' : 'private',
      application_questions: data.application_questions ?? [],
      brief_url: data.brief_url || null,
      metadata: {
        event_date: eventDays.find(day => day.starts_at)?.starts_at.slice(0, 10) || event_date || null,
        reference_url: reference_url || null,
        approval_submission_url: approval_submission_url || null,
        whatsapp_group_url: data.whatsapp_group_url?.trim() || null,
        access_mode: access_mode || 'public',
      },
      application_deadline: data.visibility === 'open' && data.application_deadline
        ? new Date(data.application_deadline).toISOString()
        : null,
      max_influencers: data.visibility === 'open' ? (data.max_influencers ?? null) : null,
    }
  }

  // Las direcciones elegidas antes de que existiera la campaña se asocian apenas se crea.
  // Va ANTES de syncEventBookings: así los bookings nacen con la dirección principal.
  async function flushPendingLocations(savedCampaignId: string) {
    if (!pendingLocations.length) return
    const failed = await savePendingCampaignLocations(savedCampaignId, pendingLocations)
    setPendingLocations(failed)
    if (failed.length) toast.error(`No se pudo guardar ${failed.length === 1 ? 'una dirección' : `${failed.length} direcciones`}. Revísalas en el paso 1.`)
  }

  async function syncEventBookings(savedCampaignId: string, values: FormValues) {
    if (values.type !== 'event_appearance') return
    const completeDays = eventDays.filter(day => day.starts_at && day.ends_at)
    const incomplete = eventDays.some(day => Boolean(day.starts_at) !== Boolean(day.ends_at))
    if (incomplete) throw new Error('Completa inicio y término de cada día del evento')

    for (const bookingId of removedEventBookingIds) {
      const response = await fetch(`/api/bookings?id=${bookingId}`, { method: 'DELETE' })
      if (!response.ok) throw new Error('No se pudo quitar un día del evento')
    }

    const nextDays = [...eventDays]
    for (let index = 0; index < nextDays.length; index++) {
      const day = nextDays[index]
      if (!day.starts_at || !day.ends_at) continue
      const payload = {
        title: values.name.trim(), description: values.description ?? '',
        starts_at: new Date(day.starts_at).toISOString(), ends_at: new Date(day.ends_at).toISOString(), timezone: 'America/Santiago',
      }
      const response = await fetch('/api/bookings', {
        method: day.id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(day.id ? { id: day.id, ...payload } : { campaign_id: savedCampaignId, event_type: 'event', ...payload }),
      })
      const json = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(json.error ?? 'No se pudo guardar una fecha del evento')
      if (!day.id && json?.id) nextDays[index] = { ...day, id: json.id }
    }
    setEventDays(nextDays)
    setRemovedEventBookingIds([])
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
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (res.ok) {
          const { data: campaign } = await res.json()
          setCampaignId(campaign.id)
          await flushPendingLocations(campaign.id)
          await syncEventBookings(campaign.id, getValues())
          setDraftSavedAt(new Date())
        }
      } else {
        const res = await fetch(`${apiEndpoint}/${campaignId}`, {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (res.ok) {
          await syncEventBookings(campaignId, getValues())
          setDraftSavedAt(new Date())
        }
      }
    } catch {
      // Silencioso: el auto-guardado no debe bloquear el flujo del wizard.
    } finally {
      setDraftSaving(false)
    }
  }

  // Una vez creado el borrador, cada cambio se persiste con debounce. Así la
  // guía no depende de alcanzar el botón final para quedar guardada.
  useEffect(() => {
    if (!campaignId) return

    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`${apiEndpoint}/${campaignId}`, {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildPayload(getValues())),
        })
        if (res.ok) {
          await syncEventBookings(campaignId, getValues())
          setDraftSavedAt(new Date())
        }
      } catch {
        // Conserva el contenido local; el guardado final sigue disponible.
      }
    }, 700)

    return () => window.clearTimeout(timer)
    // buildPayload y getValues no dependen de estado mutable del componente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, apiEndpoint, autosaveSignature])

  async function goNext() {
    const fieldsPerStep: Record<number, (keyof FormValues)[]> = { 1: ['name'] }
    const ok = await trigger(fieldsPerStep[step] ?? [])
    if (!ok) return

    // El autosave ocurre al avanzar. Cuando se entra a Contenido, deja los
    // entregables sugeridos dentro del mismo snapshot que se persiste, en vez
    // de cargarlos recién después de crear el borrador.
    if (step === 2 && campaignType && (getValues('deliverable_templates') ?? []).length === 0) {
      const suggested = CAMPAIGN_DELIVERABLE_DEFAULTS[campaignType] ?? []
      if (suggested.length > 0) {
        setValue('deliverable_templates', suggested.map(template => ({ ...template, due_date: '' })))
      }
    }
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
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Error al crear campaña')
      }
      const { data: campaign } = await res.json()
      const savedCampaignId = campaign?.id ?? campaignId
      if (!savedCampaignId) throw new Error('No se pudo identificar la campaña creada')
      await flushPendingLocations(savedCampaignId)
      await syncEventBookings(savedCampaignId, data)

      // La marca sigue trabajando sobre un borrador durante el autosave, pero
      // al terminar el formulario lo envía de inmediato a revisión. La API
      // mantiene la decisión de activar exclusivamente para administración.
      if (portal === 'brand') {
        const reviewRes = await fetch(`${apiEndpoint}/${savedCampaignId}`, {
          method: 'PATCH',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'submit_for_approval' }),
        })
        if (!reviewRes.ok) {
          const reviewError = await reviewRes.json().catch(() => ({}))
          throw new Error(reviewError.error ?? 'La campaña se creó, pero no se pudo enviar a revisión')
        }
      }

      toast.success(portal === 'brand' ? 'Campaña enviada a revisión' : 'Campaña creada correctamente')
      router.push(`${redirectBase}/${savedCampaignId}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setSaving(false)
    }
  }

  // La creación ahora solo valida los campos visibles y esenciales.
  const STEP_BY_FIELD: Record<string, number> = { name: 1, description: 1, brand_id: 1, start_date: 1 }

  function findFirstError(node: unknown, path: string[] = []): { path: string[]; message?: string } | null {
    if (!node || typeof node !== 'object') return null
    const record = node as Record<string, unknown>
    if (typeof record.message === 'string' && typeof record.type === 'string') return { path, message: record.message }
    for (const key of Object.keys(record)) {
      if (key === 'ref' || key === 'types') continue
      const found = findFirstError(record[key], [...path, key])
      if (found) return found
    }
    return null
  }

  function onInvalid(formErrors: FieldErrors<FormValues>) {
    console.error('[CampaignForm] validación falló:', formErrors)
    const found = findFirstError(formErrors)
    const rootField = found?.path[0]
    const targetStep = rootField ? (STEP_BY_FIELD[rootField] ?? 1) : 1
    setStep(targetStep)
    toast.error(
      found?.message
        ? `Paso ${targetStep}: ${found.message}`
        : 'Revisa los campos marcados en rojo antes de crear la campaña'
    )
  }

  return (
    <div className="max-w-4xl mx-auto space-y-2">
      {/* Header */}
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={() => router.back()} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-500"><ChevronLeft className="h-5 w-5" /></button>
        <div><h1 className="text-lg font-bold text-gray-900 tracking-tight">Nueva campaña</h1><p className="text-sm text-gray-400">{draftSavedAt && <span className="text-emerald-500">Borrador guardado ✓</span>}</p></div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit(onSubmit, onInvalid)}>
        <div className="card p-3">
          {step === 1 && <Step1 register={register} control={control} errors={errors} eventDays={eventDays} setEventDays={setEventDays} campaignId={campaignId} pendingLocations={pendingLocations} setPendingLocations={setPendingLocations} setRemovedEventBookingIds={setRemovedEventBookingIds} portal={portal} campaignType={campaignType} />}
        </div>

        {/* Navigation */}
        <div className="flex justify-between mt-2">
          <button type="button" onClick={() => setStep(s => Math.max(1, s - 1))} disabled={step === 1}
            className="flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-gray-600 rounded-xl border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            <ChevronLeft className="h-4 w-4" /> Anterior
          </button>

          <button type="submit" disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors">
            {saving ? <><div className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />Creando…</> : <><Sparkles className="h-4 w-4" />{portal === 'brand' ? 'Crear y enviar a revisión' : 'Crear campaña'}</>}
          </button>
        </div>
      </form>
    </div>
  )
}
