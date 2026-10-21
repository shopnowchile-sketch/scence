'use client'

import { useRef, useState } from 'react'
import { Paperclip, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'

export type CrmAttachment = { path: string; name: string; size: number }

const MAX_BYTES = 4 * 1024 * 1024
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx,.pptx'

export default function AttachmentPicker({
  value, onChange, disabled,
}: { value: CrmAttachment | null; onChange: (next: CrmAttachment | null) => void; disabled?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  async function onPick(file: File | undefined) {
    if (!file) return
    if (file.size > MAX_BYTES) { toast.error('El archivo supera los 4 MB'); return }
    setUploading(true)
    try {
      const body = new FormData()
      body.append('file', file)
      const r = await fetch('/api/crm-leads/attachments', { method: 'POST', body })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error ?? 'No se pudo subir el archivo')
      onChange(j as CrmAttachment)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo subir el archivo')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div>
      <label className="block text-xs font-semibold text-gray-500 mb-1">Adjunto (opcional)</label>
      <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={e => onPick(e.target.files?.[0])} />
      {value ? (
        <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
          <Paperclip className="w-3.5 h-3.5 text-violet-500 shrink-0" />
          <span className="truncate">{value.name}</span>
          <span className="text-gray-400 shrink-0">{(value.size / 1024).toFixed(0)} KB</span>
          <button type="button" disabled={disabled} onClick={() => onChange(null)} aria-label="Quitar adjunto" className="ml-auto text-gray-400 hover:text-red-500">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled || uploading}
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-xl border border-dashed border-gray-300 px-3 py-2 text-xs font-medium text-gray-600 hover:border-violet-400 hover:text-violet-600 disabled:opacity-50"
        >
          {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Paperclip className="w-3.5 h-3.5" />}
          {uploading ? 'Subiendo…' : 'Adjuntar archivo'}
        </button>
      )}
      <p className="mt-1 text-xs text-gray-400">PDF, imagen, Word, Excel o PowerPoint · máx. 4 MB.</p>
    </div>
  )
}
