'use client'

import { useEffect, useState } from 'react'
import { Eye, Loader2, Mail, X } from 'lucide-react'
import { toast } from 'sonner'
import type { EmailTemplateDefinition } from '@/lib/email-catalog'

export function CampaignEmailModal({
  campaignId,
  campaignName,
  influencerIds,
  initialTemplateKey,
  onClose,
  onSent,
}: {
  campaignId: string
  campaignName: string
  influencerIds: string[]
  initialTemplateKey?: string
  onClose: () => void
  onSent: () => void
}) {
  const [templates, setTemplates] = useState<EmailTemplateDefinition[]>([])
  const [templateKey, setTemplateKey] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [actionUrl, setActionUrl] = useState(`https://scence-app.vercel.app/inf-campaign/${campaignId}`)
  const [buttonLabel, setButtonLabel] = useState('Ver campaña →')
  const [preview, setPreview] = useState<{ subject: string; html: string; recipient_name: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState<'preview' | 'send' | null>(null)

  useEffect(() => {
    let active = true
    void fetch(`/api/campaigns/${campaignId}/emails`)
      .then(async response => {
        const json = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(json.error ?? 'No se pudieron cargar los templates')
        if (!active) return
        const available = (json.data ?? []) as EmailTemplateDefinition[]
        setTemplates(available)
        const initialTemplate = available.find(template => template.key === initialTemplateKey) ?? available[0]
        if (initialTemplate) selectTemplate(initialTemplate)
      })
      .catch(error => toast.error(error instanceof Error ? error.message : 'No se pudieron cargar los templates'))
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
    // selectTemplate sólo actualiza estado local y usa campaignName estable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, initialTemplateKey])

  function selectTemplate(template: EmailTemplateDefinition) {
    setTemplateKey(template.key)
    setSubject(template.defaultSubject.replaceAll('{{campaign_name}}', campaignName))
    setMessage(template.defaultMessage ?? '')
    setButtonLabel(template.defaultButtonLabel ?? 'Ver campaña →')
    setPreview(null)
  }

  function updateField(setter: (value: string) => void, value: string) {
    setter(value)
    setPreview(null)
  }

  async function submit(action: 'preview' | 'send') {
    if (!templateKey || !subject.trim() || !message.trim()) return toast.error('Completa template, asunto y mensaje')
    setWorking(action)
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/emails`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          template_key: templateKey,
          influencer_ids: influencerIds,
          subject,
          message,
          action_url: actionUrl,
          button_label: buttonLabel,
        }),
      })
      const json = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(json.error ?? 'No se pudo procesar el email')
      if (action === 'preview') {
        setPreview(json.data)
      } else {
        toast.success(`Email enviado a ${json.data.sent} influencer${json.data.sent === 1 ? '' : 's'}`)
        onSent()
        onClose()
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo procesar el email')
    } finally {
      setWorking(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div className="mx-auto my-6 max-w-4xl rounded-2xl bg-white shadow-xl" onClick={event => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <h2 className="font-bold text-gray-900">Enviar email</h2>
            <p className="text-xs text-gray-500">{influencerIds.length} influencer{influencerIds.length === 1 ? '' : 's'} aceptada{influencerIds.length === 1 ? '' : 's'} · {campaignName}</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar"><X className="h-5 w-5 text-gray-400" /></button>
        </div>

        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-violet-600" /></div>
        ) : (
          <div className="grid gap-5 p-5 lg:grid-cols-2">
            <div className="space-y-4">
              <label className="block text-sm font-semibold text-gray-700">
                Template
                <select className="input-base mt-1" value={templateKey} onChange={event => {
                  const selected = templates.find(template => template.key === event.target.value)
                  if (selected) selectTemplate(selected)
                }}>
                  {templates.map(template => <option key={template.key} value={template.key}>{template.name}</option>)}
                </select>
              </label>
              <label className="block text-sm font-semibold text-gray-700">
                Asunto
                <input className="input-base mt-1" value={subject} maxLength={180} onChange={event => updateField(setSubject, event.target.value)} />
              </label>
              <label className="block text-sm font-semibold text-gray-700">
                Mensaje
                <textarea className="input-base mt-1 min-h-32 resize-y" value={message} maxLength={5000} onChange={event => updateField(setMessage, event.target.value)} />
              </label>
              <label className="block text-sm font-semibold text-gray-700">
                Link del botón
                <input className="input-base mt-1" type="url" value={actionUrl} onChange={event => updateField(setActionUrl, event.target.value)} />
              </label>
              <label className="block text-sm font-semibold text-gray-700">
                Texto del botón
                <input className="input-base mt-1" value={buttonLabel} maxLength={80} onChange={event => updateField(setButtonLabel, event.target.value)} />
              </label>
              <p className="text-xs text-gray-400">La personalización aplica sólo a este envío y no modifica el template original.</p>
            </div>

            <div className="min-h-96 rounded-xl border bg-gray-50 p-3">
              {preview ? (
                <div className="h-full">
                  <p className="mb-2 text-xs text-gray-500">Preview para {preview.recipient_name} · <b>{preview.subject}</b></p>
                  <iframe title="Vista previa del email" sandbox="" srcDoc={preview.html} className="h-[520px] w-full rounded-lg border bg-white" />
                </div>
              ) : (
                <div className="flex h-full min-h-96 flex-col items-center justify-center text-center text-gray-400">
                  <Eye className="mb-3 h-8 w-8" />
                  <p className="text-sm">Genera la vista previa antes de enviar.</p>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t px-5 py-4">
          <button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm font-semibold text-gray-600">Cancelar</button>
          <button disabled={!!working || loading} onClick={() => void submit('preview')} className="inline-flex items-center gap-2 rounded-lg border border-violet-200 px-4 py-2 text-sm font-semibold text-violet-700 disabled:opacity-50">
            {working === 'preview' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />} Preview
          </button>
          <button disabled={!preview || !!working || loading} onClick={() => void submit('send')} className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {working === 'send' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Enviar
          </button>
        </div>
      </div>
    </div>
  )
}
