'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Download, FileText, Loader2, PenLine, X } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { downloadDocumentPdf } from '@/lib/document-pdf'
import { BRAND_LEGAL_FIX_URL, type MissingLegalField } from '@/lib/brand-legal-profile'

type Document = {
  id: string; title: string; document_type: string; language: string; status: 'pending' | 'signed' | 'voided' | 'superseded'
  content_snapshot: string; signer_name: string | null; signer_rut: string | null; signer_role: string | null; signer_email: string | null; signed_at: string | null; due_at: string; created_at: string
}
type LegalData = {
  company: { name: string; rut: string; address: string }
  representative: { name: string; rut: string; role: string }
}
type LegalState = { complete: boolean; missing: MissingLegalField[]; fixUrl: string; data: LegalData | null }

const dash = (value: string | null | undefined) => (value && value.trim() ? value : '—')

// Los datos legales NO se piden aquí: se registran una sola vez en Organización (Perfil legal).
function LegalMissingNotice({ legal }: { legal: LegalState }) {
  return <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-900">
    <div className="flex gap-2 font-semibold"><AlertCircle className="h-4 w-4 mt-0.5" />Antes de firmar, completa los datos legales en Organización.</div>
    <p className="mt-2">Falta{legal.missing.length > 1 ? 'n' : ''}:</p>
    <ul className="mt-1 list-disc pl-5">{legal.missing.map(field => <li key={field.key}>{field.label}</li>)}</ul>
    <Link href={legal.fixUrl} className="inline-flex mt-3 bg-violet-600 text-white rounded-lg px-3 py-2 text-sm font-semibold">Completar en Organización</Link>
  </div>
}

function LegalDataReview({ data }: { data: LegalData }) {
  const Row = ({ label, value }: { label: string; value: string }) => <div><dt className="text-xs text-gray-400">{label}</dt><dd className="text-sm font-medium text-gray-900">{dash(value)}</dd></div>
  return <div className="rounded-xl border border-gray-200 p-4 space-y-3">
    <p className="font-semibold text-gray-900">Datos que se firmarán</p>
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Row label="Empresa" value={data.company.name} /><Row label="RUT de la empresa" value={data.company.rut} />
      <div className="sm:col-span-2"><Row label="Domicilio legal" value={data.company.address} /></div>
      <Row label="Representante legal" value={data.representative.name} /><Row label="RUT personal" value={data.representative.rut} />
      <Row label="Cargo" value={data.representative.role} />
    </dl>
    <p className="text-xs text-gray-400">¿Algo no es correcto? Corrígelo en <Link href={BRAND_LEGAL_FIX_URL} className="text-violet-700 underline">Organización</Link> antes de firmar.</p>
  </div>
}

function DocumentModal({ document, canSign, legal, onClose, onSigned }: { document: Document; canSign: boolean; legal: LegalState; onClose: () => void; onSigned: () => void }) {
  const [accepted, setAccepted] = useState(false)
  const [saving, setSaving] = useState(false)
  const sign = async () => {
    setSaving(true)
    try {
      // Solo viaja la aceptación: el servidor firma con los datos legales registrados.
      const res = await fetch(`/api/brand/documents/${document.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accepted }) })
      const json = await res.json(); if (!res.ok) throw new Error(json.error ?? 'No se pudo firmar')
      toast.success('Documento firmado'); onSigned(); onClose()
    } catch (e) { toast.error((e as Error).message); onSigned() } finally { setSaving(false) }
  }
  const downloadPdf = async () => {
    await downloadDocumentPdf(document)
  }
  return <div className="fixed inset-0 z-50 bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
    <div className="max-w-3xl mx-auto my-8 bg-white rounded-2xl shadow-xl" onClick={e => e.stopPropagation()}>
      <div className="p-5 border-b flex justify-between items-center"><div><h2 className="font-bold text-gray-900">{document.title}</h2><p className="text-xs text-gray-400">Versión registrada · {document.language.toUpperCase()}</p></div><div className="flex gap-2"><button onClick={downloadPdf} className="inline-flex gap-1 items-center text-xs font-semibold text-violet-700"><Download className="h-4 w-4" />PDF</button><button onClick={onClose}><X className="h-5 w-5 text-gray-400" /></button></div></div>
      <div className="p-6 space-y-5"><pre className="whitespace-pre-wrap font-sans text-sm leading-6 text-gray-700 bg-gray-50 p-5 rounded-xl border">{document.content_snapshot}</pre>
        {document.status === 'signed'
          ? <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-4 text-sm text-emerald-800"><b>Firmado</b> por {document.signer_name} el {new Date(document.signed_at!).toLocaleString('es-CL')}.</div>
          : !canSign
            ? <p className="text-sm text-gray-500">Solo el owner de la Marca, que es su representante legal, puede firmar este documento.</p>
            : <div className="space-y-4 border-t pt-5">
              {legal.data && <LegalDataReview data={legal.data} />}
              {!legal.complete
                ? <LegalMissingNotice legal={legal} />
                : <>
                  <label className="flex gap-2 text-sm text-gray-600"><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} />Declaro tener facultades para representar a la Marca y acepto íntegramente este documento.</label>
                  <button disabled={saving || !accepted} onClick={sign} className="bg-violet-600 text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">{saving ? 'Firmando…' : 'Firmar documento'}</button>
                </>}
            </div>}
      </div>
    </div></div>
}

export default function BrandDocumentsPage() {
  const [documents, setDocuments] = useState<Document[]>([]); const [canSign, setCanSign] = useState(false)
  const [legal, setLegal] = useState<LegalState>({ complete: true, missing: [], fixUrl: BRAND_LEGAL_FIX_URL, data: null })
  const [loading, setLoading] = useState(true); const [selected, setSelected] = useState<Document | null>(null)
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/brand/documents'); const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'No se pudieron cargar los documentos')
      setDocuments(json.data ?? []); setCanSign(json.can_sign === true)
      setLegal({ complete: json.legal_profile_complete === true, missing: json.missing ?? [], fixUrl: json.fix_url ?? BRAND_LEGAL_FIX_URL, data: json.legal_data ?? null })
    } catch (e) { toast.error((e as Error).message) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])
  const pending = documents.filter(d => d.status === 'pending')
  return <div className="max-w-4xl mx-auto space-y-6"><div><h1 className="text-2xl font-bold text-gray-900">Documentos</h1><p className="text-sm text-gray-500 mt-1">Acuerdos enviados por SCENCE para tu Marca.</p></div>
    {!legal.complete && pending.length > 0 && <LegalMissingNotice legal={legal} />}
    {pending.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900"><b>Acción requerida:</b> tienes {pending.length} documento{pending.length > 1 ? 's' : ''} pendiente{pending.length > 1 ? 's' : ''} de firma. El plazo vence el {new Date(pending[0].due_at).toLocaleDateString('es-CL', { day: 'numeric', month: 'long' })}.</div>}
    {loading ? <div className="py-16 flex justify-center"><Loader2 className="animate-spin text-violet-600" /></div> : documents.length === 0 ? <div className="card p-10 text-center text-gray-500"><FileText className="h-8 w-8 mx-auto mb-3 text-gray-300" />No tienes documentos pendientes.</div> : <div className="space-y-3">{documents.map(d => <button key={d.id} onClick={() => setSelected(d)} className="card w-full p-4 flex text-left items-center justify-between hover:border-violet-200"><div><p className="font-semibold text-gray-900">{d.title}</p><p className="text-sm text-gray-400">{d.status === 'signed' ? 'Firmado' : `Firma antes del ${new Date(d.due_at).toLocaleDateString('es-CL')}`}</p></div>{d.status === 'signed' ? <span className="inline-flex items-center gap-1 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" />Firmado</span> : <span className="inline-flex items-center gap-1 text-sm text-amber-700"><PenLine className="h-4 w-4" />Pendiente de firma</span>}</button>)}</div>}
    {selected && <DocumentModal document={selected} canSign={canSign} legal={legal} onClose={() => setSelected(null)} onSigned={load} />}</div>
}
