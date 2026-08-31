'use client'

import { FormEvent, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Download, FileText, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'

type Acceptance = { id: string; document_title: string; document_version: string; content_snapshot: string; status: string; accepted_at: string }
type UploadedDocument = { id: string; document_type: string; title: string; original_filename: string; mime_type: string; file_size: number; created_at: string }

export function InfluencerDocuments() {
  const [acceptances, setAcceptances] = useState<Acceptance[]>([])
  const [uploads, setUploads] = useState<UploadedDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)

  const load = useCallback(async () => {
    const [termsResponse, documentsResponse] = await Promise.all([
      fetch('/api/influencer/terms'),
      fetch('/api/influencer/documents'),
    ])
    const [terms, documents] = await Promise.all([termsResponse.json(), documentsResponse.json()])
    setAcceptances(terms.data ?? [])
    setUploads(documents.data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  async function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    setUploading(true)
    try {
      const response = await fetch('/api/influencer/documents', { method: 'POST', body: new FormData(form) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      toast.success('Documento subido correctamente.')
      form.reset()
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo subir el documento.')
    } finally {
      setUploading(false)
    }
  }

  async function openDocument(document: UploadedDocument) {
    const response = await fetch(`/api/influencer/documents/${document.id}`)
    const result = await response.json()
    if (!response.ok) return toast.error(result.error ?? 'No se pudo abrir el documento.')
    window.open(result.url, '_blank', 'noopener,noreferrer')
  }

  async function deleteDocument(document: UploadedDocument) {
    if (!confirm(`¿Eliminar “${document.title}”?`)) return
    const response = await fetch(`/api/influencer/documents/${document.id}`, { method: 'DELETE' })
    const result = await response.json()
    if (!response.ok) return toast.error(result.error ?? 'No se pudo eliminar el documento.')
    setUploads(current => current.filter(item => item.id !== document.id))
    toast.success('Documento eliminado.')
  }

  if (loading) return <div className="py-10 text-center text-sm text-gray-400">Cargando documentos…</div>

  return <div className="mx-auto max-w-3xl space-y-5">
    <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3"><div className="rounded-xl bg-violet-100 p-2 text-violet-600"><Upload className="h-5 w-5" /></div><div><h2 className="font-bold text-gray-900">Subir documento</h2><p className="text-xs text-gray-500">Visible únicamente para marcas donde estés aprobada.</p></div></div>
      <form onSubmit={uploadDocument} className="mt-4 grid gap-3 sm:grid-cols-[150px_1fr]">
        <select name="document_type" required className="rounded-lg border border-gray-200 px-3 py-2 text-sm"><option value="portfolio">Portfolio</option><option value="identity">Identidad</option><option value="other">Otro</option></select>
        <input name="title" required maxLength={120} placeholder="Título del documento" className="rounded-lg border border-gray-200 px-3 py-2 text-sm" />
        <input name="file" required type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="sm:col-span-2 rounded-lg border border-dashed border-gray-300 p-3 text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-violet-50 file:px-3 file:py-2 file:font-semibold file:text-violet-700" />
        <button disabled={uploading} className="sm:col-span-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-50">{uploading ? 'SUBIENDO…' : 'SUBIR DOCUMENTO'}</button>
      </form>
      <p className="mt-2 text-xs text-gray-400">PDF, JPG, PNG o WebP · máximo 10 MB.</p>
    </section>

    <section className="rounded-2xl border border-gray-100 bg-white p-5">
      <h2 className="font-bold text-gray-900">Mis documentos</h2>
      {uploads.length === 0 ? <p className="mt-4 text-sm text-gray-500">Todavía no has subido documentos.</p> : <div className="mt-3 divide-y divide-gray-100">{uploads.map(document => <div key={document.id} className="flex items-center gap-3 py-3"><FileText className="h-5 w-5 text-violet-500" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-gray-900">{document.title}</p><p className="truncate text-xs text-gray-400">{document.original_filename} · {(document.file_size / 1024 / 1024).toFixed(1)} MB</p></div><button onClick={() => void openDocument(document)} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-violet-600" aria-label="Descargar"><Download className="h-4 w-4" /></button><button onClick={() => void deleteDocument(document)} className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600" aria-label="Eliminar"><Trash2 className="h-4 w-4" /></button></div>)}</div>}
    </section>

    {acceptances.length > 0 && <section className="rounded-2xl border border-gray-100 bg-white p-5"><h2 className="font-bold text-gray-900">Términos aceptados</h2><div className="mt-3 space-y-2">{acceptances.map(document => <details key={document.id} className="rounded-lg bg-gray-50 p-3"><summary className="cursor-pointer text-sm font-semibold text-gray-700">{document.document_title} · v{document.document_version}</summary><pre className="mt-3 whitespace-pre-wrap font-sans text-xs leading-5 text-gray-500">{document.content_snapshot}</pre></details>)}</div><Link href="/terms/influencer-pro" className="mt-3 inline-block text-xs text-violet-600 hover:underline">Ver términos vigentes</Link></section>}
  </div>
}
