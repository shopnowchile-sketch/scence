'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Globe, Lock, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { DeliverableTemplateBuilder, type DeliverableTemplate } from './DeliverableTemplateBuilder'
import { PlanUpgradeWall } from '@/components/plan/PlanUpgradeWall'
import { getPlanLimits, getPlanTier } from '@/lib/plan-limits'

const CAMPAIGN_TYPES = [
  { value: 'sponsored_post',  label: 'Paid Post',        desc: 'Contenido patrocinado con tarifa fija' },
  { value: 'product_seeding', label: 'Gifted',           desc: 'Envío de producto, sin fee monetario' },
  { value: 'event_appearance',label: 'Evento',           desc: 'Asistencia a lanzamiento o evento' },
  { value: 'ambassador',      label: 'Brand Ambassador', desc: 'Acuerdo de largo plazo, múltiples entregas' },
]

const PLATFORMS = ['instagram', 'tiktok', 'youtube', 'twitter', 'facebook']

export function BrandCampaignForm() {
  const router  = useRouter()
  const [loading, setLoading] = useState(false)
  const [deliverableTemplates, setDeliverableTemplates] = useState<DeliverableTemplate[]>([])
  const [orgPlan, setOrgPlan] = useState<string>('free')
  const [atCampaignLimit, setAtCampaignLimit] = useState(false)
  const [hasUsedFirstPublicCampaign, setHasUsedFirstPublicCampaign] = useState(false)
  const [planReady, setPlanReady] = useState(false)
  const [form, setForm] = useState({
    name: '', type: 'sponsored_post',
    visibility: 'private' as 'private' | 'open',
    description: '', start_date: '', end_date: '',
    budget_total: '', application_deadline: '',
    max_influencers: '', content_guidelines: '', hashtags: '',
    platforms: [] as string[],
  })

  // Pre-check plan limits on mount so we can show upgrade wall before submission
  useEffect(() => {
    async function checkPlan() {
      try {
        const [meRes, camsRes] = await Promise.all([
          fetch('/api/brand/me'),
          fetch('/api/brand/campaigns'),
        ])
        const meJson  = meRes.ok  ? await meRes.json()  : null
        const camsJson = camsRes.ok ? await camsRes.json() : null

        const plan   = meJson?.data?.org_plan ?? 'free'
        const limits = getPlanLimits(plan)
        const campaigns = camsJson?.data ?? []
        const active = campaigns.filter(
          (c: { status: string }) => !['completed', 'canceled'].includes(c.status)
        ).length
        const openCampaigns = campaigns.filter(
          (c: { visibility?: string }) => c.visibility === 'open'
        ).length

        setOrgPlan(plan)
        setHasUsedFirstPublicCampaign(openCampaigns > 0)
        setAtCampaignLimit(active >= limits.max_active_campaigns)
      } catch {
        // Non-fatal: form will still work, backend will gate
      } finally {
        setPlanReady(true)
      }
    }
    checkPlan()
  }, [])

  function set(key: string, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  function togglePlatform(p: string) {
    setForm(f => ({
      ...f,
      platforms: f.platforms.includes(p) ? f.platforms.filter(x => x !== p) : [...f.platforms, p],
    }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { toast.error('El nombre es requerido'); return }
    setLoading(true)
    try {
      const res = await fetch('/api/brand/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:                 form.name.trim(),
          type:                 form.type,
          visibility:           form.visibility,
          description:          form.description || null,
          start_date:           form.start_date || null,
          end_date:             form.end_date   || null,
          budget_total:         form.budget_total ? Number(form.budget_total) : null,
          application_deadline: form.visibility === 'open' && form.application_deadline ? form.application_deadline : null,
          max_influencers:      form.visibility === 'open' && form.max_influencers ? Number(form.max_influencers) : null,
          content_guidelines:    form.content_guidelines || null,
          hashtags:              form.hashtags ? form.hashtags.split(',').map(h => h.trim()).filter(Boolean) : [],
          platforms:             form.platforms,
          deliverable_templates: deliverableTemplates.length > 0 ? deliverableTemplates : undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Campaña creada')
      router.push(`/brand-campaigns/${json.data.id}`)
    } catch (e) { toast.error((e as Error).message) }
    setLoading(false)
  }

  const limits   = getPlanLimits(orgPlan)
  const canOpen  = limits.can_create_open_campaigns || !hasUsedFirstPublicCampaign
  const planTier = getPlanTier(orgPlan)

  // Show upgrade wall if at campaign limit (only after plan check completes)
  if (planReady && atCampaignLimit) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <button onClick={() => router.push('/brand/dashboard')}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft className="h-4 w-4" /> Volver
        </button>
        <PlanUpgradeWall
          title="Límite de campañas alcanzado"
          description={`Tu plan ${limits.label} permite máximo ${limits.max_active_campaigns} campaña${limits.max_active_campaigns !== 1 ? 's' : ''} activa${limits.max_active_campaigns !== 1 ? 's' : ''}. Cancela una o sube de plan para crear más.`}
          currentPlan={orgPlan}
          requiredPlan={planTier === 'basic' ? 'growth' : 'pro'}
        />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <button onClick={() => router.push('/brand/dashboard')}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4">
          <ArrowLeft className="h-4 w-4" /> Volver
        </button>
        <h1 className="text-2xl font-bold text-gray-900">Nueva campaña</h1>
        <p className="text-sm text-gray-400 mt-0.5">Define los detalles básicos — podrás editar después</p>
      </div>

      <form onSubmit={submit} className="space-y-6">
        {/* Básico */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
          <h2 className="text-sm font-bold text-gray-700">Información básica</h2>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Nombre *</label>
            <input value={form.name} onChange={e => set('name', e.target.value)} required
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-400"
              placeholder="Ej: Lanzamiento Verano 2026" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Tipo de campaña *</label>
            <div className="grid grid-cols-2 gap-2">
              {CAMPAIGN_TYPES.map(t => (
                <button key={t.value} type="button" onClick={() => set('type', t.value)}
                  className={cn('text-left px-3 py-2.5 rounded-xl border text-sm transition-all',
                    form.type === t.value ? 'border-violet-400 bg-violet-50 text-violet-700' : 'border-gray-200 hover:border-gray-300')}>
                  <div className="font-semibold">{t.label}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{t.desc}</div>
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Descripción</label>
            <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={3} resize-none
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-400 resize-none"
              placeholder="Objetivo, mensaje clave, audiencia target…" />
          </div>
        </div>

        {/* Visibilidad */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
          <h2 className="text-sm font-bold text-gray-700">Visibilidad</h2>
          <div className="grid grid-cols-2 gap-3">
            {/* Privada — siempre disponible */}
            <button type="button" onClick={() => set('visibility', 'private')}
              className={cn('flex flex-col items-start gap-1.5 px-4 py-3 rounded-xl border transition-all',
                form.visibility === 'private' ? 'border-violet-400 bg-violet-50' : 'border-gray-200 hover:border-gray-300')}>
              <div className="flex items-center gap-2">
                <Lock className={cn('h-4 w-4', form.visibility === 'private' ? 'text-violet-600' : 'text-gray-400')} />
                <span className={cn('text-sm font-semibold', form.visibility === 'private' ? 'text-violet-700' : 'text-gray-700')}>Privada</span>
              </div>
              <p className="text-xs text-gray-400">Tú invitas a los influencers directamente</p>
            </button>

            {/* Abierta — solo Pro */}
            <button
              type="button"
              disabled={!canOpen}
              onClick={() => canOpen && set('visibility', 'open')}
              className={cn(
                'flex flex-col items-start gap-1.5 px-4 py-3 rounded-xl border transition-all relative',
                !canOpen
                  ? 'border-gray-100 bg-gray-50 cursor-not-allowed opacity-70'
                  : form.visibility === 'open'
                    ? 'border-emerald-400 bg-emerald-50'
                    : 'border-gray-200 hover:border-gray-300',
              )}>
              {/* Pro badge */}
              {!canOpen && (
                <span className="absolute top-2 right-2 text-[10px] font-bold text-violet-600 bg-violet-100 px-1.5 py-0.5 rounded-full">Pro</span>
              )}
              <div className="flex items-center gap-2">
                <Globe className={cn('h-4 w-4', form.visibility === 'open' && canOpen ? 'text-emerald-600' : 'text-gray-400')} />
                <span className={cn('text-sm font-semibold', form.visibility === 'open' && canOpen ? 'text-emerald-700' : 'text-gray-700')}>Abierta</span>
              </div>
              <p className="text-xs text-gray-400">Influencers pueden postular — tú apruebas</p>
            </button>
          </div>
          {form.visibility === 'open' && (
            <div className="grid grid-cols-2 gap-4 pt-2">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Fecha límite postulaciones</label>
                <input type="date" value={form.application_deadline} onChange={e => set('application_deadline', e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-400" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Cupo máximo</label>
                <input type="number" min={1} value={form.max_influencers} onChange={e => set('max_influencers', e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-400"
                  placeholder="Sin límite" />
              </div>
            </div>
          )}
        </div>

        {/* Fechas y presupuesto */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
          <h2 className="text-sm font-bold text-gray-700">Fechas y presupuesto</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Fecha inicio</label>
              <input type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Fecha fin</label>
              <input type="date" value={form.end_date} onChange={e => set('end_date', e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-400" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Presupuesto total (CLP)</label>
            <input type="number" min={0} value={form.budget_total} onChange={e => set('budget_total', e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-400"
              placeholder="Ej: 5000000" />
          </div>
        </div>

        {/* Contenido */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
          <h2 className="text-sm font-bold text-gray-700">Contenido</h2>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">Plataformas</label>
            <div className="flex flex-wrap gap-2">
              {PLATFORMS.map(p => (
                <button key={p} type="button" onClick={() => togglePlatform(p)}
                  className={cn('px-3 py-1 rounded-full text-xs font-medium border transition-all capitalize',
                    form.platforms.includes(p) ? 'bg-violet-600 text-white border-violet-600' : 'border-gray-200 text-gray-600 hover:border-gray-300')}>
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Hashtags (separados por coma)</label>
            <input value={form.hashtags} onChange={e => set('hashtags', e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-400"
              placeholder="#verano2026, #miMarca" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Lineamientos de contenido</label>
            <textarea value={form.content_guidelines} onChange={e => set('content_guidelines', e.target.value)} rows={3}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-400 resize-none"
              placeholder="Qué incluir, qué evitar, tono de comunicación…" />
          </div>
        </div>

        {/* Deliverables */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
          <div>
            <h2 className="text-sm font-bold text-gray-700">Entregables requeridos</h2>
            <p className="text-xs text-gray-400 mt-0.5">Define qué debe entregar cada influencer. Se asignarán automáticamente al incorporarlos.</p>
          </div>
          <DeliverableTemplateBuilder
            value={deliverableTemplates}
            onChange={setDeliverableTemplates}
            campaignType={form.type}
            showSuggestions={true}
          />
        </div>

        {/* Submit */}
        <div className="flex gap-3 pb-8">
          <button type="button" onClick={() => router.push('/brand/dashboard')}
            className="flex-1 py-3 border border-gray-200 text-sm font-semibold text-gray-600 rounded-xl hover:bg-gray-50 transition-colors">
            Cancelar
          </button>
          <button type="submit" disabled={loading}
            className="flex-1 flex items-center justify-center gap-2 py-3 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700 disabled:opacity-60 transition-colors">
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {loading ? 'Creando…' : 'Crear campaña'}
          </button>
        </div>
      </form>
    </div>
  )
}
