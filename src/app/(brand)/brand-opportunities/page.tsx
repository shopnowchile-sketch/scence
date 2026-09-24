'use client'
import { useEffect, useState } from 'react'
import { Building2, Check, CheckCircle2, Download, FileText, Loader2, Minus, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { formatCurrency, formatDate } from '@/lib/utils'
import {
  ACTIVATION_DYNAMICS_CLAUSE,
  NO_GUARANTEED_PUBLICATIONS_CLAUSE,
  NON_EXCLUSIVITY_CLAUSE,
  formatPlanMoney,
  paymentTermLines,
  planScopeLines,
  type BrandOpportunityDTO,
  type PublicBrandPlan,
} from '@/lib/brand-plans'
import { formatProposalDateTime, type BrandProposalView } from '@/lib/brand-proposal'
import { downloadProposalPdf } from '@/lib/brand-proposal-pdf'

// Oportunidades para marcas. Todo lo que se muestra sale del DTO público de
// GET /api/brand/collaboration-opportunities (planes activos, sin notas
// internas). El PDF comercial es material de apoyo; los planes son la fuente.

type Opportunity = {
  id: string
  name: string
  brand?: { name?: string | null } | null
  application_deadline?: string | null
  collaboration_opportunity: BrandOpportunityDTO
  application_status?: string | null
  application_id?: string | null
  proposal?: BrandProposalView | null
  has_sponsor_brief?: boolean
}

const STATUS_LABEL: Record<string, string> = { pending: 'En revisión', approved_for_payment: 'Aprobada para pago', active: 'Activa', rejected: 'No seleccionada' }

function PlanCard({ plan }: { plan: PublicBrandPlan }) {
  const scope = planScopeLines(plan, null)
  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-sm font-bold uppercase tracking-wide text-violet-700">{plan.name}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900">{formatPlanMoney(plan.price, plan.currency)}</p>
      {plan.description && <p className="mt-2 text-sm text-gray-600">{plan.description}</p>}
      <ul className="mt-3 space-y-1.5 text-sm text-gray-700">
        {scope.included.map(item => <li key={item} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />{item}</li>)}
        {scope.excluded.map(item => <li key={item} className="flex gap-2 text-gray-400"><Minus className="mt-0.5 h-4 w-4 shrink-0" />{item}</li>)}
      </ul>
      {plan.additional_terms && <p className="mt-3 text-xs text-gray-500">{plan.additional_terms}</p>}
      <div className="mt-auto pt-3 text-xs text-gray-400"><p className="font-semibold text-gray-500">Forma de pago</p>{paymentTermLines(plan.payment_terms).map(line => <p key={line}>{line}</p>)}</div>
    </div>
  )
}

function ProposalBlock({ applicationId, proposal, onAccepted }: { applicationId: string; proposal: BrandProposalView; onAccepted: () => void }) {
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [saving, setSaving] = useState(false)
  async function accept() {
    setSaving(true)
    try {
      const res = await fetch(`/api/brand/proposals/${applicationId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'accept', confirm: true }) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'No se pudo aceptar la propuesta')
      toast.success('Propuesta aceptada. SCENCE te enviará el contrato.')
      onAccepted()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo aceptar la propuesta')
      onAccepted()
    } finally {
      setSaving(false)
    }
  }
  const badge = proposal.status === 'accepted' ? 'bg-emerald-50 text-emerald-700' : proposal.status === 'expired' ? 'bg-amber-50 text-amber-700' : 'bg-violet-50 text-violet-700'
  const label = proposal.status === 'accepted' ? 'Aceptada' : proposal.status === 'expired' ? 'Vencida' : 'Pendiente de aceptación'
  return (
    <div className="mt-5 rounded-xl border border-violet-100 bg-violet-50/30 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <FileText className="h-4 w-4 text-violet-600" />
        <p className="min-w-0 flex-1 text-sm font-semibold text-gray-800">Propuesta comercial · Plan {proposal.plan_snapshot.name} · {formatPlanMoney(proposal.plan_snapshot.price, proposal.plan_snapshot.currency)}</p>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge}`}>{label}</span>
      </div>
      <p className="mt-1 text-xs text-gray-500">{proposal.status === 'accepted' && proposal.accepted_at ? `Aceptada el ${formatProposalDateTime(proposal.accepted_at)}. SCENCE te enviará el contrato definitivo.` : proposal.status === 'expired' ? 'El plazo de aceptación terminó. Escríbenos para recibir una nueva versión.' : `Acepta antes del ${formatProposalDateTime(proposal.accept_deadline)} para mantener estas condiciones.`}</p>
      <div className="mt-3 flex flex-wrap gap-3 text-sm">
        <button type="button" onClick={() => setOpen(!open)} className="font-semibold text-violet-700 hover:underline">{open ? 'Ocultar propuesta' : 'Ver propuesta'}</button>
        <button type="button" onClick={() => void downloadProposalPdf(proposal)} className="inline-flex items-center gap-1 font-semibold text-violet-700 hover:underline"><Download className="h-4 w-4" />PDF</button>
      </div>
      {open && <pre className="mt-3 max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-lg bg-white p-4 text-xs leading-relaxed text-gray-700 ring-1 ring-gray-100">{proposal.content}</pre>}
      {proposal.status === 'sent' && (
        <div className="mt-4 space-y-2">
          <label className="flex items-start gap-2 text-xs text-gray-600"><input type="checkbox" checked={confirm} onChange={e => setConfirm(e.target.checked)} className="mt-0.5 accent-violet-600" />Acepto esta propuesta comercial. Entiendo que el contrato definitivo formalizará las obligaciones, el alcance y la forma de pago.</label>
          <button type="button" disabled={!confirm || saving} onClick={() => void accept()} className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{saving && <Loader2 className="h-4 w-4 animate-spin" />}Aceptar propuesta</button>
        </div>
      )}
    </div>
  )
}

export default function BrandOpportunitiesPage() {
  const [items, setItems] = useState<Opportunity[]>([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ plan_id: '', sampling: '', activation_details: '', links: '' })
  const load = () => fetch('/api/brand/collaboration-opportunities').then(r => r.json()).then(j => setItems(j.data ?? [])).catch(() => toast.error('No se pudieron cargar las oportunidades')).finally(() => setLoading(false))
  useEffect(() => { load() }, [])
  async function apply(campaignId: string) { setSaving(true); try { const res = await fetch('/api/brand/collaboration-opportunities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ campaign_id: campaignId, ...form }) }); const json = await res.json(); if (!res.ok) throw new Error(json.error); toast.success('Postulación enviada para revisión'); setOpenId(null); setForm({ plan_id: '', sampling: '', activation_details: '', links: '' }); load() } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo postular') } finally { setSaving(false) } }
  async function downloadProposal(campaignId: string) { try { const res = await fetch(`/api/campaigns/${campaignId}/assets`); const json = await res.json(); if (!res.ok) throw new Error(json.error); const doc = (json.data ?? []).find((asset: { metadata?: { asset_type?: string }; signed_url?: string | null }) => asset.metadata?.asset_type === 'sponsor_brief'); if (!doc?.signed_url) throw new Error('La propuesta comercial no está disponible'); window.open(doc.signed_url, '_blank', 'noopener,noreferrer') } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo descargar la propuesta') } }

  return <main className="mx-auto max-w-5xl space-y-6 p-6 md:p-10">
    <div><p className="text-sm font-semibold text-violet-600">Colaboraciones</p><h1 className="text-3xl font-bold text-gray-900">Oportunidades para tu marca</h1><p className="mt-1 text-gray-500">Activa tu marca en eventos y campañas de SCENCE.</p></div>
    {loading ? <p className="text-gray-400">Cargando oportunidades…</p> : items.length === 0 ? <div className="rounded-2xl border border-dashed border-gray-200 p-10 text-center text-gray-500"><Building2 className="mx-auto mb-3 h-8 w-8 text-violet-400" />No hay oportunidades disponibles por ahora.</div> : <div className="space-y-6">{items.map(item => {
      const config = item.collaboration_opportunity
      const status = item.application_status
      const deadline = config.application_deadline
      return <article key={item.id} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-violet-600">{item.brand?.name ?? 'Marca'}</p><h2 className="mt-1 text-xl font-bold text-gray-900">{item.name}</h2>{deadline && <p className="mt-1 text-xs text-gray-500">Cierra el {formatDate(deadline)}</p>}</div><Sparkles className="h-5 w-5 text-violet-500" /></div>

        {config.mode === 'plans' ? <>
          <div className={`mt-5 grid gap-3 ${config.plans.length === 1 ? '' : config.plans.length === 2 ? 'md:grid-cols-2' : 'md:grid-cols-3'}`}>
            {config.plans.map(plan => <PlanCard key={plan.id} plan={plan} />)}
          </div>
          <details className="mt-4 rounded-xl bg-gray-50 p-4 text-sm text-gray-600">
            <summary className="cursor-pointer font-semibold text-gray-800">Cómo funciona la activación</summary>
            <div className="mt-2 space-y-2 text-xs leading-relaxed"><p>{ACTIVATION_DYNAMICS_CLAUSE}</p><p>{NO_GUARANTEED_PUBLICATIONS_CLAUSE}</p><p>{NON_EXCLUSIVITY_CLAUSE}</p><p>Cuando el plan incluye Collab, SCENCE gestiona la solicitud de colaboración con la cuenta que se acuerde; la marca puede aceptarla o no.</p></div>
          </details>
        </> : <>
          <p className="mt-4 text-sm text-gray-600">{config.benefits || 'Colaboración de marca en campaña.'}</p>
          <div className="mt-4 text-sm"><p className="text-gray-400">Participación</p><p className="font-semibold">{config.participation_value ? formatCurrency(config.participation_value, config.currency) : 'Sin costo'}</p></div>
        </>}

        {item.proposal && item.application_id && <ProposalBlock applicationId={item.application_id} proposal={item.proposal} onAccepted={load} />}
        {item.has_sponsor_brief && <button type="button" onClick={() => downloadProposal(item.id)} className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-fuchsia-700 hover:underline"><Download className="h-4 w-4" />Descargar propuesta comercial (PDF)</button>}
        {item.proposal ? null : status ? <p className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-violet-50 px-3 py-2 text-sm font-semibold text-violet-700"><CheckCircle2 className="h-4 w-4" />{STATUS_LABEL[status] ?? 'En revisión'}</p> : <><button onClick={() => setOpenId(openId === item.id ? null : item.id)} className="mt-5 block rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700">Me interesa</button>{openId === item.id && <div className="mt-4 space-y-3 rounded-xl bg-gray-50 p-4"><p className="text-sm font-semibold text-gray-800">Cuéntanos sobre tu marca</p>{config.mode === 'plans' && <select value={form.plan_id} onChange={e => setForm({ ...form, plan_id: e.target.value })} className="input-base w-full text-sm"><option value="">Plan de interés (opcional)</option>{config.plans.map(plan => <option key={plan.id} value={plan.id}>{plan.name} · {formatPlanMoney(plan.price, plan.currency)}</option>)}</select>}<input value={form.sampling} onChange={e => setForm({ ...form, sampling: e.target.value })} placeholder="Sampling o regalo que aportarás" className="input-base w-full text-sm" /><textarea value={form.activation_details} onChange={e => setForm({ ...form, activation_details: e.target.value })} placeholder="Qué te gustaría activar" className="input-base min-h-20 w-full text-sm" /><input value={form.links} onChange={e => setForm({ ...form, links: e.target.value })} placeholder="Link a materiales (opcional)" className="input-base w-full text-sm" /><button disabled={saving} onClick={() => apply(item.id)} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Enviando…' : 'Enviar'}</button></div>}</>}
      </article>
    })}</div>}
  </main>
}
