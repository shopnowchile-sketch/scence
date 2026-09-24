'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, Eye, Loader2, RefreshCw, Send, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { formatPlanMoney, type PlanCurrency } from '@/lib/brand-plans'
import { PROPOSAL_ACCEPTANCE_BUSINESS_DAYS, PROPOSAL_VALIDITY_CALENDAR_DAYS, formatProposalDateTime, type ProposalStatus } from '@/lib/brand-proposal'
import { downloadProposalPdf } from '@/lib/brand-proposal-pdf'

// Propuestas comerciales por marca (Admin). Todo el contenido lo genera el
// servidor desde el plan guardado: aquí solo se elige marca, plan, cuenta
// Collab y, si hace falta, se corrigen los datos del evento para la propuesta.

type PlanOption = { id: string; name: string; price: number; currency: PlanCurrency; collaboration_included: boolean }
type ProposalSummary = {
  version: number; status: ProposalStatus; plan_id: string; plan_name: string; price: number; currency: PlanCurrency
  collaboration_account: string | null; event: { name: string | null; date: string | null; start_time: string | null; location: string | null }
  issued_at: string; valid_until: string; accept_by: string; accept_deadline: string; accepted_at: string | null; title: string; content: string
}
type ApplicationRow = { id: string; brand: { id: string; name: string; instagram: string | null } | null; application_status: string; requested_plan_id: string | null; proposal: ProposalSummary | null; history_count: number }
type PanelData = { opportunity_enabled: boolean; mode: string | null; plans: PlanOption[]; event_defaults: { name?: string; date?: string; startTime?: string; location?: string }; applications: ApplicationRow[] }
type BrandOption = { id: string; name: string; instagram: string | null }

const STATUS: Record<ProposalStatus, { label: string; className: string }> = {
  sent: { label: 'Enviada', className: 'bg-violet-50 text-violet-700' },
  accepted: { label: 'Aceptada', className: 'bg-emerald-50 text-emerald-700' },
  withdrawn: { label: 'Retirada', className: 'bg-gray-100 text-gray-500' },
  superseded: { label: 'Reemplazada', className: 'bg-gray-100 text-gray-500' },
  expired: { label: 'Vencida', className: 'bg-amber-50 text-amber-700' },
}

const handle = (instagram: string | null | undefined) => (instagram ? `@${instagram.replace(/^@+/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/\/+$/, '')}` : '')

export function BrandProposalsPanel({ campaignId }: { campaignId: string }) {
  const [data, setData] = useState<PanelData | null>(null)
  const [brands, setBrands] = useState<BrandOption[]>([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState({ brand_id: '', plan_id: '', collaboration_account: '', event_name: '', event_date: '', event_time: '', event_location: '', replace_accepted: false })
  const [preview, setPreview] = useState<{ title: string; content: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [openContent, setOpenContent] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/brand-proposals`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setData(json.data)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudieron cargar las propuestas')
    } finally {
      setLoading(false)
    }
  }, [campaignId])

  useEffect(() => { void load() }, [load])

  async function openForm(prefill?: ApplicationRow) {
    if (!brands.length) {
      const res = await fetch('/api/brands?options=1&limit=5000')
      const json = await res.json().catch(() => ({}))
      if (res.ok) setBrands(json.data ?? [])
    }
    const defaults = data?.event_defaults ?? {}
    const previous = prefill?.proposal
    setForm({
      brand_id: prefill?.brand?.id ?? '',
      plan_id: previous?.plan_id ?? prefill?.requested_plan_id ?? '',
      collaboration_account: previous?.collaboration_account ?? handle(prefill?.brand?.instagram),
      event_name: previous?.event.name ?? defaults.name ?? '',
      event_date: previous?.event.date ?? defaults.date ?? '',
      event_time: previous?.event.start_time ?? defaults.startTime ?? '',
      event_location: previous?.event.location ?? defaults.location ?? '',
      replace_accepted: false,
    })
    setPreview(null)
    setFormOpen(true)
  }

  const selectedPlan = useMemo(() => data?.plans.find(p => p.id === form.plan_id), [data, form.plan_id])
  const existingForBrand = useMemo(() => data?.applications.find(a => a.brand?.id === form.brand_id), [data, form.brand_id])

  async function submit(action: 'preview' | 'issue') {
    setBusy(action)
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/brand-proposals`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action, brand_id: form.brand_id, plan_id: form.plan_id, collaboration_account: form.collaboration_account,
          event: { name: form.event_name, date: form.event_date, start_time: form.event_time, location: form.event_location },
          replace_accepted: form.replace_accepted,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'No se pudo generar la propuesta')
      if (action === 'preview') {
        setPreview({ title: json.data.title, content: json.data.content })
      } else {
        toast.success(json.data.email_sent ? 'Propuesta enviada a la marca' : 'Propuesta emitida (el email no pudo enviarse)')
        setFormOpen(false)
        setPreview(null)
        await load()
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error')
    } finally {
      setBusy(null)
    }
  }

  async function withdraw(applicationId: string) {
    setBusy(applicationId)
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/brand-proposals`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'withdraw', application_id: applicationId }) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'No se pudo retirar')
      toast.success('Propuesta retirada')
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error')
    } finally {
      setBusy(null)
    }
  }

  const canIssue = Boolean(data?.opportunity_enabled && data.mode === 'plans' && data.plans.length)

  return (
    <section className="card space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-700">Propuestas a marcas</h3>
          <p className="mt-0.5 text-xs text-gray-500">Vigencia {PROPOSAL_VALIDITY_CALENDAR_DAYS} días corridos · aceptación dentro de {PROPOSAL_ACCEPTANCE_BUSINESS_DAYS} días hábiles. El contenido sale del plan guardado.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void load()} title="Actualizar" className="rounded-lg p-2 text-gray-400 hover:bg-gray-50"><RefreshCw className="h-4 w-4" /></button>
          <button type="button" disabled={!canIssue} onClick={() => void openForm()} title={canIssue ? 'Emitir propuesta' : 'Publica la oportunidad y guarda al menos un plan activo'} className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-40"><Send className="h-3.5 w-3.5" />Emitir propuesta</button>
        </div>
      </div>

      {formOpen && (
        <div className="space-y-3 rounded-xl border border-violet-100 bg-violet-50/30 p-4">
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="text-xs font-semibold text-gray-600">Marca
              <select value={form.brand_id} onChange={e => { const brand = brands.find(b => b.id === e.target.value); setForm(f => ({ ...f, brand_id: e.target.value, collaboration_account: handle(brand?.instagram) })); setPreview(null) }} className="input-base mt-1 w-full text-sm">
                <option value="">— Seleccionar —</option>
                {brands.map(brand => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-gray-600">Plan
              <select value={form.plan_id} onChange={e => { setForm(f => ({ ...f, plan_id: e.target.value })); setPreview(null) }} className="input-base mt-1 w-full text-sm">
                <option value="">— Seleccionar —</option>
                {data?.plans.map(plan => <option key={plan.id} value={plan.id}>{plan.name} · {formatPlanMoney(plan.price, plan.currency)}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-gray-600">Cuenta Collab {selectedPlan?.collaboration_included ? <span className="text-violet-600">(obligatoria)</span> : <span className="font-normal text-gray-400">(si aplica)</span>}
              <input value={form.collaboration_account} onChange={e => { setForm(f => ({ ...f, collaboration_account: e.target.value })); setPreview(null) }} placeholder="@cuenta" className="input-base mt-1 w-full text-sm" />
            </label>
          </div>
          <div className="grid gap-2 sm:grid-cols-4">
            <input value={form.event_name} onChange={e => { setForm(f => ({ ...f, event_name: e.target.value })); setPreview(null) }} placeholder="Nombre del evento" className="input-base text-sm sm:col-span-2" />
            <input type="date" value={form.event_date} onChange={e => { setForm(f => ({ ...f, event_date: e.target.value })); setPreview(null) }} className="input-base text-sm" />
            <input type="time" value={form.event_time} onChange={e => { setForm(f => ({ ...f, event_time: e.target.value })); setPreview(null) }} className="input-base text-sm" />
            <input value={form.event_location} onChange={e => { setForm(f => ({ ...f, event_location: e.target.value })); setPreview(null) }} placeholder="Lugar del evento" className="input-base text-sm sm:col-span-4" />
          </div>
          <p className="text-[11px] text-gray-400">Los datos del evento quedan solo en la propuesta; no modifican el booking.</p>
          {existingForBrand?.proposal?.status === 'accepted' && (
            <label className="flex items-center gap-2 text-xs font-semibold text-amber-700"><input type="checkbox" checked={form.replace_accepted} onChange={e => setForm(f => ({ ...f, replace_accepted: e.target.checked }))} className="accent-amber-600" />La marca ya aceptó la versión {existingForBrand.proposal.version}. Reemplazarla por una nueva versión.</label>
          )}
          {preview && <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-4 text-xs leading-relaxed text-gray-700 ring-1 ring-gray-100">{preview.content}</pre>}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => { setFormOpen(false); setPreview(null) }} className="px-3 py-2 text-xs font-semibold text-gray-500">Cancelar</button>
            <button type="button" disabled={!form.brand_id || !form.plan_id || busy !== null} onClick={() => void submit('preview')} className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-white px-3 py-2 text-xs font-semibold text-violet-700 disabled:opacity-40">{busy === 'preview' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}Vista previa</button>
            <button type="button" disabled={!preview || busy !== null} onClick={() => void submit('issue')} title={preview ? 'Emitir y enviar a la marca' : 'Revisa la vista previa antes de emitir'} className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">{busy === 'issue' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}Emitir y enviar</button>
          </div>
        </div>
      )}

      {loading ? <p className="text-xs text-gray-400">Cargando…</p> : !data?.applications.length ? (
        <p className="rounded-xl border border-dashed border-gray-200 py-6 text-center text-xs text-gray-400">Sin postulaciones ni propuestas todavía.</p>
      ) : (
        <div className="divide-y divide-gray-100 rounded-xl border border-gray-100">
          {data.applications.map(row => {
            const p = row.proposal
            const status = p ? STATUS[p.status] : null
            return (
              <div key={row.id} className="p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 flex-1 text-sm font-semibold text-gray-800">{row.brand?.name ?? 'Marca'}{p && <span className="ml-2 font-normal text-gray-500">{p.plan_name} · {formatPlanMoney(p.price, p.currency)} · v{p.version}</span>}</p>
                  {status ? <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${status.className}`}>{status.label}</span> : <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700">Postulación</span>}
                  {p && <button type="button" onClick={() => setOpenContent(openContent === row.id ? null : row.id)} title="Ver propuesta" className="rounded p-1.5 text-gray-400 hover:bg-gray-50"><Eye className="h-4 w-4" /></button>}
                  {p && <button type="button" onClick={() => void downloadProposalPdf(p)} title="Descargar PDF" className="rounded p-1.5 text-violet-600 hover:bg-violet-50"><Download className="h-4 w-4" /></button>}
                  <button type="button" disabled={!canIssue} onClick={() => void openForm(row)} className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40">{p ? 'Reemitir' : 'Emitir'}</button>
                  {p && (p.status === 'sent' || p.status === 'expired') && <button type="button" disabled={busy === row.id} onClick={() => void withdraw(row.id)} title="Retirar propuesta" className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"><Undo2 className="h-4 w-4" /></button>}
                </div>
                {p && <p className="mt-1 text-[11px] text-gray-500">{p.status === 'accepted' && p.accepted_at ? `Aceptada el ${formatProposalDateTime(p.accepted_at)}` : `Aceptar antes de ${formatProposalDateTime(p.accept_deadline)} · vigente hasta ${formatProposalDateTime(p.valid_until)}`}{p.collaboration_account ? ` · Collab ${p.collaboration_account}` : ''}{row.history_count ? ` · ${row.history_count} versión(es) anterior(es)` : ''}</p>}
                {p && openContent === row.id && <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-xs leading-relaxed text-gray-700">{p.content}</pre>}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
