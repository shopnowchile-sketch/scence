'use client'

import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Eye, EyeOff, Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { DEFAULT_PLAN_PAYMENT_TERMS, formatPlanMoney, paymentTermLines, readOpportunity, type BrandPlan, type PlanFieldError } from '@/lib/brand-plans'

// Configuración de "Planes para marcas" de una campaña.
// Fuente de verdad: campaigns.metadata.collaboration_opportunity (vía
// PUT /api/campaigns/[id]/collaboration-opportunity). Ningún nombre ni precio
// de plan vive en código: cada campaña define los suyos.
// Los planes guardados no se borran (propuestas y contratos los referencian):
// se desactivan. Solo un plan nuevo aún no guardado puede quitarse.

type DraftPlan = {
  key: string
  id?: string
  name: string
  description: string
  price: string
  currency: 'CLP' | 'USD'
  active: boolean
  benefits: string
  influencer_minimum: string
  influencer_minimum_label: string
  stand_included: boolean
  brand_brief_included: boolean
  influencer_content_included: boolean
  collaboration_included: boolean
  additional_terms: string
  internal_notes: string
  payment_terms: BrandPlan['payment_terms'] | null
}

const FLAGS: Array<{ key: 'stand_included' | 'brand_brief_included' | 'influencer_content_included' | 'collaboration_included'; label: string }> = [
  { key: 'stand_included', label: 'Stand de marca' },
  { key: 'brand_brief_included', label: 'Brief de marca' },
  { key: 'influencer_content_included', label: 'Contenido durante el evento' },
  { key: 'collaboration_included', label: 'Gestión de Collab' },
]

function toDraft(plan: BrandPlan): DraftPlan {
  return {
    key: plan.id,
    id: plan.id,
    name: plan.name,
    description: plan.description,
    price: String(plan.price),
    currency: plan.currency,
    active: plan.active,
    benefits: plan.benefits.join('\n'),
    influencer_minimum: plan.influencer_minimum ? String(plan.influencer_minimum) : '',
    influencer_minimum_label: plan.influencer_minimum_label ?? '',
    stand_included: plan.stand_included,
    brand_brief_included: plan.brand_brief_included,
    influencer_content_included: plan.influencer_content_included,
    collaboration_included: plan.collaboration_included,
    additional_terms: plan.additional_terms,
    internal_notes: plan.internal_notes,
    payment_terms: plan.payment_terms,
  }
}

function emptyDraft(): DraftPlan {
  return {
    key: `new-${Math.random().toString(36).slice(2)}`,
    name: '', description: '', price: '', currency: 'CLP', active: true, benefits: '',
    influencer_minimum: '', influencer_minimum_label: '',
    stand_included: false, brand_brief_included: false, influencer_content_included: false, collaboration_included: false,
    additional_terms: '', internal_notes: '', payment_terms: null,
  }
}

export function CollaborationOpportunitySettings({ campaignId, initial, canEdit }: { campaignId: string; initial?: Record<string, unknown> | null; canEdit: boolean }) {
  const initialView = useMemo(() => readOpportunity({ collaboration_opportunity: initial ?? undefined }), [initial])
  const [enabled, setEnabled] = useState(Boolean(initial?.enabled))
  const [deadline, setDeadline] = useState(String(initial?.application_deadline ?? ''))
  const [legacy] = useState({
    benefits: String(initial?.benefits ?? ''),
    participation_value: String(initial?.participation_value ?? ''),
    currency: String(initial?.currency ?? 'CLP'),
    seats: String(initial?.seats ?? ''),
  })
  const [plans, setPlans] = useState<DraftPlan[]>(initialView?.mode === 'plans' ? initialView.plans.map(toDraft) : [])
  const [errors, setErrors] = useState<PlanFieldError[]>([])
  const [saving, setSaving] = useState(false)

  if (!canEdit) return null

  const update = (key: string, patch: Partial<DraftPlan>) => setPlans(list => list.map(p => (p.key === key ? { ...p, ...patch } : p)))
  const move = (index: number, delta: number) => setPlans(list => {
    const next = [...list]
    const target = index + delta
    if (target < 0 || target >= next.length) return list
    ;[next[index], next[target]] = [next[target], next[index]]
    return next
  })
  const errorFor = (index: number, field: string) => errors.find(e => e.plan_index === index && (e.field === field || e.field.startsWith(`${field}.`)))?.message

  async function save() {
    setSaving(true)
    setErrors([])
    try {
      const payload = {
        enabled,
        application_deadline: deadline || null,
        ...legacy,
        plans: plans.map((plan, index) => ({
          id: plan.id,
          name: plan.name,
          description: plan.description,
          price: plan.price,
          currency: plan.currency,
          active: plan.active,
          display_order: index + 1,
          benefits: plan.benefits.split('\n'),
          influencer_minimum: plan.influencer_minimum || null,
          influencer_minimum_label: plan.influencer_minimum_label,
          stand_included: plan.stand_included,
          brand_brief_included: plan.brand_brief_included,
          influencer_content_included: plan.influencer_content_included,
          collaboration_included: plan.collaboration_included,
          additional_terms: plan.additional_terms,
          internal_notes: plan.internal_notes,
          ...(plan.payment_terms ? { payment_terms: plan.payment_terms } : {}),
        })),
      }
      const res = await fetch(`/api/campaigns/${campaignId}/collaboration-opportunity`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (Array.isArray(json.errors)) setErrors(json.errors)
        throw new Error(json.error ?? 'No se pudo guardar')
      }
      const saved = readOpportunity({ collaboration_opportunity: json.data })
      setPlans(saved?.mode === 'plans' ? saved.plans.map(toDraft) : [])
      toast.success('Planes guardados')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar')
    } finally {
      setSaving(false)
    }
  }

  const activeCount = plans.filter(p => p.active).length
  const globalErrors = errors.filter(e => e.plan_index < 0)

  return (
    <section className="card space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-700">Planes para marcas</h3>
          <p className="mt-0.5 text-xs text-gray-500">Las marcas ven los planes activos en Oportunidades. Los planes no se borran: se desactivan.</p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-gray-700">
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="h-4 w-4 accent-violet-600" />
          Publicar a marcas
        </label>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs font-semibold text-gray-600">Fecha límite para marcas
          <input type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)} className="input-base mt-1 w-full" />
        </label>
        {enabled && activeCount === 0 && (
          <p className="self-end rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">No hay planes activos: las marcas no verán esta campaña.</p>
        )}
      </div>

      {globalErrors.map(e => <p key={`${e.plan_id}-${e.message}`} className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{e.message}</p>)}

      <div className="space-y-3">
        {plans.map((plan, index) => (
          <article key={plan.key} className={`rounded-xl border p-4 ${plan.active ? 'border-gray-200 bg-white' : 'border-dashed border-gray-200 bg-gray-50 opacity-80'}`}>
            <div className="flex flex-wrap items-center gap-2">
              <input value={plan.name} onChange={e => update(plan.key, { name: e.target.value })} placeholder="Nombre del plan" className="input-base min-w-0 flex-1 text-sm font-semibold" />
              <input value={plan.price} onChange={e => update(plan.key, { price: e.target.value })} inputMode="numeric" placeholder="Precio" className="input-base w-32 text-sm" />
              <select value={plan.currency} onChange={e => update(plan.key, { currency: e.target.value as 'CLP' | 'USD' })} className="input-base w-20 text-sm"><option>CLP</option><option>USD</option></select>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => move(index, -1)} disabled={index === 0} title="Subir" className="rounded p-1.5 text-gray-400 hover:bg-gray-100 disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
                <button type="button" onClick={() => move(index, 1)} disabled={index === plans.length - 1} title="Bajar" className="rounded p-1.5 text-gray-400 hover:bg-gray-100 disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
                <button type="button" onClick={() => update(plan.key, { active: !plan.active })} title={plan.active ? 'Desactivar' : 'Activar'} className="rounded p-1.5 text-gray-500 hover:bg-gray-100">{plan.active ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}</button>
                {!plan.id && <button type="button" onClick={() => setPlans(list => list.filter(p => p.key !== plan.key))} title="Quitar plan sin guardar" className="rounded p-1.5 text-gray-300 hover:bg-red-50 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>}
              </div>
            </div>
            {(errorFor(index, 'name') || errorFor(index, 'price') || errorFor(index, 'currency')) && (
              <p className="mt-1 text-xs text-red-600">{errorFor(index, 'name') ?? errorFor(index, 'price') ?? errorFor(index, 'currency')}</p>
            )}
            {plan.price && Number(plan.price) > 0 && <p className="mt-1 text-xs text-gray-400">{formatPlanMoney(Number(plan.price), plan.currency)} · {plan.active ? 'Visible para marcas' : 'Desactivado'}</p>}

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <textarea value={plan.description} onChange={e => update(plan.key, { description: e.target.value })} placeholder="Descripción breve" className="input-base min-h-16 text-sm" />
              <textarea value={plan.benefits} onChange={e => update(plan.key, { benefits: e.target.value })} placeholder="Beneficios (uno por línea)" className="input-base min-h-16 text-sm" />
              {(errorFor(index, 'description') || errorFor(index, 'benefits')) && <p className="text-xs text-red-600 md:col-span-2">{errorFor(index, 'description') ?? errorFor(index, 'benefits')}</p>}
              <div className="flex flex-wrap gap-2 md:col-span-2">
                {FLAGS.map(flag => (
                  <label key={flag.key} className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${plan[flag.key] ? 'border-violet-200 bg-violet-50 text-violet-700' : 'border-gray-200 text-gray-500'}`}>
                    <input type="checkbox" checked={plan[flag.key]} onChange={e => update(plan.key, { [flag.key]: e.target.checked } as Partial<DraftPlan>)} className="h-3 w-3 accent-violet-600" />
                    {flag.label}
                  </label>
                ))}
              </div>
              <div className="flex gap-2">
                <input value={plan.influencer_minimum} onChange={e => update(plan.key, { influencer_minimum: e.target.value })} inputMode="numeric" placeholder="Influencers en la dinámica (ej. 10)" className="input-base min-w-0 flex-1 text-sm" />
                <input value={plan.influencer_minimum_label} onChange={e => update(plan.key, { influencer_minimum_label: e.target.value })} placeholder="Texto (ej. 10+)" className="input-base w-28 text-sm" />
              </div>
              <p className="self-center text-xs text-gray-400">Participación en la dinámica del evento, no publicaciones garantizadas.</p>
              {errorFor(index, 'influencer_minimum') && <p className="text-xs text-red-600 md:col-span-2">{errorFor(index, 'influencer_minimum')}</p>}
              <textarea value={plan.additional_terms} onChange={e => update(plan.key, { additional_terms: e.target.value })} placeholder="Condiciones adicionales (visibles para la marca)" className="input-base min-h-14 text-sm" />
              <textarea value={plan.internal_notes} onChange={e => update(plan.key, { internal_notes: e.target.value })} placeholder="Notas internas (solo SCENCE)" className="input-base min-h-14 border-amber-200 bg-amber-50/40 text-sm" />
              {(errorFor(index, 'additional_terms') || errorFor(index, 'payment_terms')) && <p className="text-xs text-red-600 md:col-span-2">{errorFor(index, 'additional_terms') ?? errorFor(index, 'payment_terms')}</p>}
            </div>
            <p className="mt-2 text-[11px] text-gray-400">Pago: {paymentTermLines(plan.payment_terms ?? DEFAULT_PLAN_PAYMENT_TERMS).join(' · ')}</p>
          </article>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={() => setPlans(list => [...list, emptyDraft()])} className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 px-3 py-2 text-xs font-semibold text-violet-700 hover:bg-violet-50">
          <Plus className="h-3.5 w-3.5" />Agregar plan
        </button>
        <button type="button" disabled={saving} onClick={() => void save()} className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}{saving ? 'Guardando…' : 'Guardar planes'}
        </button>
      </div>
    </section>
  )
}
