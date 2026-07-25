'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Download, FileText, Loader2, PenLine, X } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'

type Document = {
  id: string; title: string; document_type: string; language: string; status: 'pending' | 'signed' | 'voided' | 'superseded'
  content_snapshot: string; signer_name: string | null; signer_rut: string | null; signer_role: string | null; signer_email: string | null; signed_at: string | null; due_at: string; created_at: string
}

function DocumentModal({ document, canSign, legalProfileComplete, missingLegalFields, onClose, onSigned }: { document: Document; canSign: boolean; legalProfileComplete: boolean; missingLegalFields: string[]; onClose: () => void; onSigned: () => void }) {
  const [name, setName] = useState(document.signer_name ?? '')
  const [rut, setRut] = useState(document.signer_rut ?? '')
  const [role, setRole] = useState(document.signer_role ?? '')
  const [accepted, setAccepted] = useState(false)
  const [saving, setSaving] = useState(false)
  const sign = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/brand/documents/${document.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signer_name: name, signer_rut: rut, signer_role: role, accepted }) })
      const json = await res.json(); if (!res.ok) throw new Error(json.error ?? 'No se pudo firmar')
      toast.success('Documento firmado'); onSigned(); onClose()
    } catch (e) { toast.error((e as Error).message) } finally { setSaving(false) }
  }
  const downloadPdf = async () => {
    const { jsPDF } = await import('jspdf')
    const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
    const margin = 48; const width = pdf.internal.pageSize.getWidth() - margin * 2
    let y = 56
    const add = (text: string, size = 10, bold = false) => {
      pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(size)
      const lines = pdf.splitTextToSize(text, width)
      for (const line of lines) { if (y > 780) { pdf.addPage(); y = 56 }; pdf.text(line, margin, y); y += size + 5 }
    }
    add('SCENCE · DOCUMENTO ELECTRÓNICO', 9, true); y += 12
    add(document.title, 16, true); y += 10; add(document.content_snapshot, 10)
    y += 14; add('EVIDENCIA DE FIRMA', 11, true)
    add(document.status === 'signed' ? `Firmado por: ${document.signer_name}\nRUT: ${document.signer_rut}\nCargo: ${document.signer_role}\nFecha: ${new Date(document.signed_at!).toLocaleString('es-CL')}` : 'Documento pendiente de firma.', 10)
    pdf.save(`${document.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.pdf`)
  }
  return <div className="fixed inset-0 z-50 bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
    <div className="max-w-3xl mx-auto my-8 bg-white rounded-2xl shadow-xl" onClick={e => e.stopPropagation()}>
      <div className="p-5 border-b flex justify-between items-center"><div><h2 className="font-bold text-gray-900">{document.title}</h2><p className="text-xs text-gray-400">Versión registrada · {document.language.toUpperCase()}</p></div><div className="flex gap-2"><button onClick={downloadPdf} className="inline-flex gap-1 items-center text-xs font-semibold text-violet-700"><Download className="h-4 w-4" />PDF</button><button onClick={onClose}><X className="h-5 w-5 text-gray-400" /></button></div></div>
      <div className="p-6 space-y-5"><pre className="whitespace-pre-wrap font-sans text-sm leading-6 text-gray-700 bg-gray-50 p-5 rounded-xl border">{document.content_snapshot}</pre>
        {document.status === 'signed' ? <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-4 text-sm text-emerald-800"><b>Firmado</b> por {document.signer_name} el {new Date(document.signed_at!).toLocaleString('es-CL')}.</div> : !legalProfileComplete ? <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-900"><div className="flex gap-2 font-semibold"><AlertCircle className="h-4 w-4 mt-0.5" />Antes de firmar, completa los datos legales de tu empresa.</div><p className="mt-2">Faltan: {missingLegalFields.join(', ')}. El NDA se actualizará automáticamente con esa información.</p><Link href="/brand-settings/organization" className="inline-flex mt-3 bg-violet-600 text-white rounded-lg px-3 py-2 text-sm font-semibold">Completar organización</Link></div> : canSign ? <div className="space-y-3 border-t pt-5"><p className="font-semibold text-gray-900">Firma electrónica</p><div className="grid grid-cols-1 sm:grid-cols-3 gap-3"><input className="input-base" placeholder="Nombre completo" value={name} onChange={e => setName(e.target.value)} /><input className="input-base" placeholder="RUT" value={rut} onChange={e => setRut(e.target.value)} /><input className="input-base" placeholder="Cargo" value={role} onChange={e => setRole(e.target.value)} /></div><label className="flex gap-2 text-sm text-gray-600"><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} />Declaro tener facultades para representar a la Marca y acepto íntegramente este documento.</label><button disabled={saving} onClick={sign} className="bg-violet-600 text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">{saving ? 'Firmando…' : 'Firmar documento'}</button></div> : <p className="text-sm text-gray-500">Solo el owner o un administrador de la Marca puede firmar este documento.</p>}</div>
    </div></div>
}

export default function BrandDocumentsPage() {
  const [documents, setDocuments] = useState<Document[]>([]); const [canSign, setCanSign] = useState(false); const [legalProfileComplete, setLegalProfileComplete] = useState(true); const [missingLegalFields, setMissingLegalFields] = useState<string[]>([]); const [loading, setLoading] = useState(true); const [selected, setSelected] = useState<Document | null>(null)
  const load = useCallback(async () => { setLoading(true); try { const res = await fetch('/api/brand/documents'); const json = await res.json(); if (!res.ok) throw new Error(json.error ?? 'No se pudieron cargar los documentos'); setDocuments(json.data ?? []); setCanSign(json.can_sign === true); setLegalProfileComplete(json.legal_profile_complete === true); setMissingLegalFields(json.missing_legal_fields ?? []) } catch (e) { toast.error((e as Error).message) } finally { setLoading(false) } }, [])
  useEffect(() => { load() }, [load])
  const pending = documents.filter(d => d.status === 'pending')
  return <div className="max-w-4xl mx-auto space-y-6"><div><h1 className="text-2xl font-bold text-gray-900">Documentos</h1><p className="text-sm text-gray-500 mt-1">Acuerdos enviados por SCENCE para tu Marca.</p></div>{!legalProfileComplete && pending.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900"><div className="font-bold">Completa los datos legales de tu empresa antes de firmar.</div><p className="text-sm mt-1">Faltan: {missingLegalFields.join(', ')}. Esta información se incorporará automáticamente al NDA.</p><Link href="/brand-settings/organization" className="inline-flex mt-3 bg-violet-600 text-white rounded-lg px-3 py-2 text-sm font-semibold">Ir a Organización</Link></div>}{pending.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900"><b>Acción requerida:</b> tienes {pending.length} documento{pending.length > 1 ? 's' : ''} pendiente{pending.length > 1 ? 's' : ''} de firma. El plazo vence el {new Date(pending[0].due_at).toLocaleDateString('es-CL', { day: 'numeric', month: 'long' })}.</div>}{loading ? <div className="py-16 flex justify-center"><Loader2 className="animate-spin text-violet-600" /></div> : documents.length === 0 ? <div className="card p-10 text-center text-gray-500"><FileText className="h-8 w-8 mx-auto mb-3 text-gray-300" />No tienes documentos pendientes.</div> : <div className="space-y-3">{documents.map(d => <button key={d.id} onClick={() => setSelected(d)} className="card w-full p-4 flex text-left items-center justify-between hover:border-violet-200"><div><p className="font-semibold text-gray-900">{d.title}</p><p className="text-sm text-gray-400">{d.status === 'signed' ? 'Firmado' : `Firma antes del ${new Date(d.due_at).toLocaleDateString('es-CL')}`}</p></div>{d.status === 'signed' ? <span className="inline-flex items-center gap-1 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" />Firmado</span> : <span className="inline-flex items-center gap-1 text-sm text-amber-700"><PenLine className="h-4 w-4" />Pendiente de firma</span>}</button>)}</div>}{selected && <DocumentModal document={selected} canSign={canSign} legalProfileComplete={legalProfileComplete} missingLegalFields={missingLegalFields} onClose={() => setSelected(null)} onSigned={load} />}</div>
}
