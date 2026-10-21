'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, History, PencilLine, Save, X } from 'lucide-react'

type Version = {
  id: string
  version_number: number
  lifecycle_status: 'proposed' | 'approved' | 'superseded'
  definition: string
  business_rules: string[]
  acceptance_criteria: string[]
  change_reason: string
  impact_summary: string
  created_at: string
  approved_at: string | null
}
type Evidence = {
  id: string
  requirement_version_id: string
  evidence_type: 'code' | 'document' | 'test' | 'impact' | 'deviation' | 'validation'
  reference: string
  details: string
  verification_status: 'passed' | 'pending' | 'failed'
  created_at: string
}
type PilotData = { requirement: { implementation_status: string; approved_version_id: string | null }; versions: Version[]; evidence: Evidence[] }

const label: Record<Version['lifecycle_status'], string> = { approved: 'Aprobada', proposed: 'Propuesta', superseded: 'Reemplazada' }

export function RequirementPilot() {
  const [data, setData] = useState<PilotData | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [definition, setDefinition] = useState('')
  const [reason, setReason] = useState('')
  const [impact, setImpact] = useState('')
  const [evidenceVersionId, setEvidenceVersionId] = useState('')
  const [evidenceType, setEvidenceType] = useState<Evidence['evidence_type']>('code')
  const [evidenceReference, setEvidenceReference] = useState('')
  const [evidenceDetails, setEvidenceDetails] = useState('')

  const load = async () => {
    const response = await fetch('/api/admin/requirements/DASH-001', { cache: 'no-store' })
    if (!response.ok) {
      setError(response.status === 404 ? 'El piloto estará disponible al aplicar la migración en un entorno de desarrollo autorizado.' : 'No se pudo cargar el registro versionado.')
      return
    }
    const payload = await response.json() as PilotData
    setData(payload)
    const approved = payload.versions.find(version => version.id === payload.requirement.approved_version_id)
    setDefinition(approved?.definition ?? '')
    setEvidenceVersionId(approved?.id ?? payload.versions[0]?.id ?? '')
  }

  useEffect(() => { void load() }, [])

  const propose = async () => {
    setSaving(true)
    setError('')
    const response = await fetch('/api/admin/requirements/DASH-001', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'propose', definition, changeReason: reason, impactSummary: impact }),
    })
    setSaving(false)
    if (!response.ok) { setError((await response.json()).error ?? 'No se pudo registrar la propuesta.'); return }
    setEditing(false); setReason(''); setImpact(''); await load()
  }
  const approve = async (versionId: string) => {
    setSaving(true); setError('')
    const response = await fetch(`/api/admin/requirements/DASH-001?versionId=${encodeURIComponent(versionId)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'approve' }),
    })
    setSaving(false)
    if (!response.ok) { setError((await response.json()).error ?? 'No se pudo aprobar la versión.'); return }
    await load()
  }

  const addEvidence = async () => {
    if (!evidenceVersionId || !evidenceReference.trim()) return
    setSaving(true)
    setError('')
    const response = await fetch('/api/admin/requirements/DASH-001', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'add_evidence', versionId: evidenceVersionId, evidenceType,
        reference: evidenceReference.trim(), details: evidenceDetails.trim(), verificationStatus: 'pending',
      }),
    })
    const payload = await response.json().catch(() => ({}))
    setSaving(false)
    if (!response.ok) { setError(payload.error ?? 'No se pudo registrar la evidencia.'); return }
    setEvidenceReference('')
    setEvidenceDetails('')
    await load()
  }

  if (error && !data) return <p className="mb-5 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">{error}</p>
  const current = data?.versions.find(version => version.id === data.requirement.approved_version_id)
  return <section className="mb-5 rounded-xl border border-violet-100 bg-violet-50/40 p-4 text-sm text-gray-700">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-semibold text-gray-900">Piloto versionado DASH-001</p><p className="text-xs text-gray-500">Fuente de verdad aprobada, historial y propuesta de cambio.</p></div>{!editing && <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-violet-700"><PencilLine className="h-3.5 w-3.5" /> Proponer cambio</button>}</div>
    {current && <p className="mt-3 text-xs leading-5"><span className="font-semibold">Definición aprobada v{current.version_number}:</span> {current.definition}</p>}
    {editing && <div className="mt-3 space-y-2"><label className="block text-xs font-semibold">Nueva definición<textarea value={definition} onChange={event => setDefinition(event.target.value)} className="mt-1 min-h-20 w-full rounded-lg border border-gray-200 bg-white p-2 text-sm font-normal outline-none focus:border-violet-400" /></label><label className="block text-xs font-semibold">Motivo del cambio<input value={reason} onChange={event => setReason(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 bg-white p-2 text-sm font-normal outline-none focus:border-violet-400" /></label><label className="block text-xs font-semibold">Impacto técnico y documental<textarea value={impact} onChange={event => setImpact(event.target.value)} placeholder="Archivos, APIs, datos, permisos, documentos y pruebas afectados" className="mt-1 min-h-16 w-full rounded-lg border border-gray-200 bg-white p-2 text-sm font-normal outline-none focus:border-violet-400" /></label><div className="flex gap-2"><button disabled={saving || !definition.trim() || !reason.trim()} onClick={() => void propose()} className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"><Save className="h-3.5 w-3.5" /> Guardar propuesta</button><button onClick={() => setEditing(false)} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-gray-600"><X className="h-3.5 w-3.5" /> Cancelar</button></div></div>}
    {data && <div className="mt-4 border-t border-violet-100 pt-3"><p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-500"><History className="h-3.5 w-3.5" /> Historial</p><ul className="mt-2 space-y-2">{data.versions.map(version => <li key={version.id} className="flex flex-wrap items-center gap-2 text-xs"><span className="font-mono font-semibold">v{version.version_number}</span><span>{label[version.lifecycle_status]}</span><span className="text-gray-500">{version.change_reason}</span>{version.impact_summary && <span className="basis-full text-gray-500">Impacto: {version.impact_summary}</span>}{version.lifecycle_status === 'proposed' && <button disabled={saving} onClick={() => void approve(version.id)} className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-white px-2 py-1 font-semibold text-emerald-700 disabled:opacity-50"><CheckCircle2 className="h-3.5 w-3.5" /> Aprobar</button>}</li>)}</ul></div>}
    {data && <div className="mt-4 border-t border-violet-100 pt-3">
      <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Evidencias persistentes</p>
      <ul className="mt-2 space-y-2">{data.evidence.map(item => {
        const version = data.versions.find(candidate => candidate.id === item.requirement_version_id)
        return <li key={item.id} className="rounded-lg border border-violet-100 bg-white p-2 text-xs">
          <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">v{version?.version_number ?? '?'}</span><span>{item.evidence_type}</span><span className={item.verification_status === 'passed' ? 'text-emerald-700' : item.verification_status === 'failed' ? 'text-red-700' : 'text-amber-700'}>{item.verification_status}</span></div>
          <p className="mt-1 break-all font-mono">{item.reference}</p>
          {item.details && <p className="mt-1 text-gray-500">{item.details}</p>}
        </li>
      })}</ul>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="text-xs font-semibold">Versión<select value={evidenceVersionId} onChange={event => setEvidenceVersionId(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 bg-white p-2 text-sm font-normal">{data.versions.map(version => <option key={version.id} value={version.id}>v{version.version_number} · {label[version.lifecycle_status]}</option>)}</select></label>
        <label className="text-xs font-semibold">Tipo<select value={evidenceType} onChange={event => setEvidenceType(event.target.value as Evidence['evidence_type'])} className="mt-1 w-full rounded-lg border border-gray-200 bg-white p-2 text-sm font-normal">{(['code', 'document', 'test', 'impact', 'deviation', 'validation'] as const).map(type => <option key={type} value={type}>{type}</option>)}</select></label>
        <label className="text-xs font-semibold sm:col-span-2">Referencia (ruta, documento o test)<input value={evidenceReference} onChange={event => setEvidenceReference(event.target.value)} maxLength={1000} className="mt-1 w-full rounded-lg border border-gray-200 bg-white p-2 text-sm font-normal" placeholder="src/... o tests/..." /></label>
        <label className="text-xs font-semibold sm:col-span-2">Detalle<textarea value={evidenceDetails} onChange={event => setEvidenceDetails(event.target.value)} maxLength={3000} className="mt-1 w-full rounded-lg border border-gray-200 bg-white p-2 text-sm font-normal" placeholder="Qué demuestra esta evidencia" /></label>
      </div>
      <button disabled={saving || !evidenceVersionId || !evidenceReference.trim()} onClick={() => void addEvidence()} className="mt-2 rounded-lg border border-violet-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-violet-700 disabled:opacity-50">Registrar evidencia</button>
    </div>}
    {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
  </section>
}
