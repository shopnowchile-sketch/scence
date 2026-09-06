'use client'

import { useEffect, useState } from 'react'
import { Loader2, FileText, Download } from 'lucide-react'
import { INFLUENCER_PRO_TERMS, downloadInfluencerProTermsPdf } from '@/lib/influencer-pro-terms'

// Confirmación ÚNICA de postulación. Reemplaza el confirm() nativo porque el
// consentimiento de una versión nueva de los Términos Pro necesita checkbox,
// link y descarga — imposible dentro de un confirm(). Cuando la influencer ya
// aceptó la versión vigente, el diálogo es exactamente la pregunta de siempre.
export function ApplyConfirmDialog({ open, campaignName, checking, needsTerms, submitting, onCancel, onConfirm }: {
  open: boolean
  campaignName: string
  checking: boolean
  needsTerms: boolean
  submitting: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const [accepted, setAccepted] = useState(false)
  useEffect(() => { if (!open) setAccepted(false) }, [open])
  if (!open) return null

  const blocked = checking || submitting || (needsTerms && !accepted)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <h2 className="text-base font-bold text-gray-900">¿Enviar solicitud para unirte a &laquo;{campaignName}&raquo;?</h2>
        <p className="mt-1 text-sm text-gray-500">El equipo la revisará y te confirmará.</p>

        {checking && (
          <p className="mt-4 flex items-center gap-2 text-sm text-gray-400"><Loader2 className="h-4 w-4 animate-spin" />Revisando tus documentos…</p>
        )}

        {!checking && needsTerms && (
          <div className="mt-4 rounded-xl border border-violet-100 bg-violet-50/60 p-3">
            <p className="text-sm font-semibold text-violet-900">Para postular debes aceptar los Términos Pro vigentes.</p>
            <div className="mt-2 flex flex-wrap gap-3">
              <a href="/terms/influencer-pro" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-bold text-violet-700 hover:underline">
                <FileText className="h-3.5 w-3.5" />Ver términos
              </a>
              <button type="button" onClick={() => void downloadInfluencerProTermsPdf()} className="inline-flex items-center gap-1.5 text-xs font-bold text-violet-700 hover:underline">
                <Download className="h-3.5 w-3.5" />Descargar PDF
              </button>
            </div>
            <label className="mt-3 flex items-start gap-2.5">
              <input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-violet-600" />
              <span className="text-sm font-semibold text-violet-900">Acepto los Términos Pro v{INFLUENCER_PRO_TERMS.version}</span>
            </label>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={submitting} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-gray-500 hover:bg-gray-50 disabled:opacity-50">
            Cancelar
          </button>
          <button type="button" onClick={onConfirm} disabled={blocked} className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold uppercase tracking-wide text-white transition-colors hover:bg-violet-700 disabled:opacity-50">
            {submitting ? 'Enviando…' : 'Postular'}
          </button>
        </div>
      </div>
    </div>
  )
}
