'use client'

import { useState } from 'react'
import { Loader2, Plus, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { renderTemplate } from '@/lib/support-tickets'

export interface SupportTemplate { key: string; name: string; body: string }

/** Texto de una plantilla para un contacto concreto (el admin lo edita antes de enviar). */
export function fillTemplate(t: SupportTemplate, contactName: string) {
  return renderTemplate(t.body, { nombre: contactName, plan_url: `${window.location.origin}/inf-profile?tab=plan` })
}

export function TemplateSelect({ templates, onPick, onEdit, className }: {
  templates: SupportTemplate[]
  onPick: (t: SupportTemplate) => void
  onEdit: () => void
  className?: string
}) {
  return (
    <div className={className ?? 'flex items-center gap-2'}>
      <select
        value=""
        onChange={e => { const t = templates.find(x => x.key === e.target.value); if (t) onPick(t) }}
        className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg bg-white text-gray-700 outline-none focus:border-violet-400"
        aria-label="Plantilla"
      >
        <option value="">Plantilla…</option>
        {templates.map(t => <option key={t.key} value={t.key}>{t.name}</option>)}
      </select>
      <button type="button" onClick={onEdit} className="text-xs font-semibold text-violet-600 hover:underline">Editar plantillas</button>
    </div>
  )
}

/** Crear, editar y eliminar plantillas. */
export function TemplatesModal({ templates, onChange, onClose }: {
  templates: SupportTemplate[]
  onChange: () => void
  onClose: () => void
}) {
  const [drafts, setDrafts] = useState<Record<string, SupportTemplate>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [fresh, setFresh] = useState({ name: '', body: '' })

  const current = (t: SupportTemplate) => drafts[t.key] ?? t
  const edit = (t: SupportTemplate, patch: Partial<SupportTemplate>) => setDrafts(d => ({ ...d, [t.key]: { ...current(t), ...patch } }))

  async function call(method: 'POST' | 'PUT' | 'DELETE', payload: unknown, url = '/api/tickets/templates') {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'DELETE' ? undefined : JSON.stringify(payload) })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.error ?? 'Error')
  }

  async function save(t: SupportTemplate) {
    setBusy(t.key)
    try { await call('PUT', current(t)); toast.success('Plantilla guardada'); onChange() }
    catch (e) { toast.error((e as Error).message) } finally { setBusy(null) }
  }
  async function remove(t: SupportTemplate) {
    if (!confirm(`¿Eliminar la plantilla «${t.name}»?`)) return
    setBusy(t.key)
    try { await call('DELETE', null, `/api/tickets/templates?key=${encodeURIComponent(t.key)}`); toast.success('Plantilla eliminada'); onChange() }
    catch (e) { toast.error((e as Error).message) } finally { setBusy(null) }
  }
  async function create() {
    setBusy('new')
    try { await call('POST', fresh); setFresh({ name: '', body: '' }); toast.success('Plantilla creada'); onChange() }
    catch (e) { toast.error((e as Error).message) } finally { setBusy(null) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 p-5">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Plantillas de respuesta</h2>
            <p className="text-xs text-gray-400 mt-0.5">Variables: {'{{nombre}}'} y {'{{plan_url}}'} (enlace al plan Pro).</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 overflow-y-auto p-5">
          {templates.map(t => {
            const c = current(t)
            const dirty = c.name !== t.name || c.body !== t.body
            return (
              <div key={t.key} className="space-y-2 rounded-xl border border-gray-100 p-3">
                <input value={c.name} onChange={e => edit(t, { name: e.target.value })} className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold outline-none focus:border-violet-400" />
                <textarea value={c.body} onChange={e => edit(t, { body: e.target.value })} rows={4} className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-violet-400" />
                <div className="flex justify-end gap-2">
                  <button onClick={() => void remove(t)} disabled={busy === t.key} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-red-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /> Eliminar</button>
                  <button onClick={() => void save(t)} disabled={!dirty || busy === t.key} className="rounded-lg bg-violet-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40">Guardar</button>
                </div>
              </div>
            )
          })}
          <div className="space-y-2 rounded-xl border border-dashed border-violet-200 p-3">
            <p className="text-xs font-bold text-violet-700">Nueva plantilla</p>
            <input value={fresh.name} onChange={e => setFresh(f => ({ ...f, name: e.target.value }))} placeholder="Nombre" className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-violet-400" />
            <textarea value={fresh.body} onChange={e => setFresh(f => ({ ...f, body: e.target.value }))} rows={3} placeholder="Mensaje" className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-violet-400" />
            <div className="flex justify-end">
              <button onClick={() => void create()} disabled={busy === 'new' || !fresh.name.trim() || !fresh.body.trim()} className="flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40">
                {busy === 'new' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Crear
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Confirmación previa a responder a varios tickets. El mensaje se puede editar. */
export function BulkReplyModal({ ids, initial, onCancel, onDone }: {
  ids: string[]
  initial: string
  onCancel: () => void
  onDone: (summary: { sent: number; failed: number; skipped: number }) => void
}) {
  const [message, setMessage] = useState(initial)
  const [sending, setSending] = useState(false)

  async function send() {
    setSending(true)
    try {
      const res = await fetch('/api/tickets/bulk-reply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket_ids: ids, message, confirm: true }) })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Error')
      onDone({ sent: json.sent, failed: json.failed, skipped: json.skipped })
    } catch (e) { toast.error((e as Error).message) } finally { setSending(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => !sending && onCancel()}>
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl" onClick={e => e.stopPropagation()} data-testid="bulk-reply-modal">
        <h2 className="text-lg font-bold text-gray-900">Responder a {ids.length} ticket(s)</h2>
        <p className="mt-1 text-xs text-gray-400">Se envía un correo a cada contacto por separado. {'{{nombre}}'} se reemplaza por su nombre. Los tickets cerrados y los que ya recibieron este mismo mensaje se omiten.</p>
        <textarea value={message} onChange={e => setMessage(e.target.value)} rows={7} className="mt-4 w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-violet-400" />
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} disabled={sending} className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50">Cancelar</button>
          <button onClick={() => void send()} disabled={sending || !message.trim()} data-testid="bulk-reply-confirm" className="flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-50">
            {sending && <Loader2 className="h-4 w-4 animate-spin" />} Enviar a {ids.length}
          </button>
        </div>
      </div>
    </div>
  )
}
