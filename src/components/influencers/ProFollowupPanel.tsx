'use client'

import { useEffect, useState } from 'react'
import { X, Loader2, Mail, ShieldAlert, History } from 'lucide-react'
import { toast } from 'sonner'

type Template = { key: string; kind: 'assistance' | 'commercial'; name: string; subject: string; body: string }
type Item = {
  influencer_id: string; name: string; to: string | null; from: string; subject: string; body: string; links: string[]
  eligible: boolean; reason: string | null; pro: string; attempts: number; unverified_charge: boolean
  last_sent: { template_key: string; created_at: string } | null
}
type Result = { influencer_id: string; name: string; to: string | null; status: 'sent' | 'failed' | 'skipped'; resend_id?: string | null; error?: string | null }
type HistoryRow = { id: string; template_key: string; to_email: string; subject: string; status: string; resend_id: string | null; error: string | null; created_at: string }

const API = '/api/influencers/pro-attempt-followup'
const post = async (body: unknown) => {
  const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json()
  if (!r.ok) throw new Error(j.error ?? 'Error')
  return j
}

export function ProFollowupPanel({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: () => void }) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [key, setKey] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [items, setItems] = useState<Item[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [results, setResults] = useState<Result[] | null>(null)
  const [history, setHistory] = useState<Record<string, HistoryRow[] | undefined>>({})
  const [openId, setOpenId] = useState<string | null>(null)

  const tpl = templates.find(t => t.key === key)

  useEffect(() => {
    fetch('/api/influencers/pro-followup-templates').then(r => r.json()).then(j => {
      const list: Template[] = j.templates ?? []
      setTemplates(list)
      if (list[0]) { setKey(list[0].key); setSubject(list[0].subject); setBody(list[0].body) }
    }).catch(() => toast.error('No se pudieron cargar las plantillas.'))
  }, [])

  function pick(k: string) {
    const t = templates.find(x => x.key === k)
    if (!t) return
    setKey(k); setSubject(t.subject); setBody(t.body); setItems(null); setConfirm(false)
  }

  async function saveTemplate() {
    if (!tpl) return
    setBusy(true)
    try {
      const r = await fetch('/api/influencers/pro-followup-templates', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, subject, body }) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error)
      setTemplates(ts => ts.map(t => t.key === key ? { ...t, subject, body } : t))
      toast.success('Plantilla guardada')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo guardar') } finally { setBusy(false) }
  }

  async function preview() {
    setBusy(true); setConfirm(false)
    try { setItems((await post({ action: 'preview', influencer_ids: ids, template_key: key, subject, body })).items) }
    catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo generar la vista previa') } finally { setBusy(false) }
  }

  async function send() {
    setBusy(true)
    try {
      const j = await post({ action: 'send', confirm: true, influencer_ids: ids, template_key: key, subject, body })
      setResults(j.results)
      toast.success(`Enviados ${j.sent} · fallidos ${j.failed} · omitidos ${j.skipped}`)
      onDone()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo enviar') } finally { setBusy(false) }
  }

  async function optout(id: string) {
    try { await post({ action: 'optout', influencer_ids: [id] }); toast.success('Baja comercial registrada'); await preview() }
    catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo registrar') }
  }

  async function toggleHistory(id: string) {
    setOpenId(openId === id ? null : id)
    if (history[id]) return
    const r = await fetch(`${API}?influencer_id=${id}`)
    const j = await r.json()
    setHistory(h => ({ ...h, [id]: j.history ?? [] }))
  }

  const eligible = (items ?? []).filter(i => i.eligible)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => !busy && onClose()}>
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-2xl" onClick={e => e.stopPropagation()} data-testid="pro-followup-panel">
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 p-5">
          <div>
            <h2 className="text-lg font-black text-gray-950">Seguimiento Pro</h2>
            <p className="mt-1 text-sm text-gray-500">{ids.length} seleccionada(s). Nada se envía hasta que confirmes.</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-4 overflow-y-auto p-5">
          {results ? (
            <div data-testid="followup-results">
              <h3 className="mb-2 text-sm font-bold text-gray-900">Resultado</h3>
              <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100 text-sm">
                {results.map(r => (
                  <li key={r.influencer_id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span>{r.name} <span className="text-gray-400">{r.to}</span></span>
                    <span className={r.status === 'sent' ? 'font-semibold text-emerald-600' : r.status === 'failed' ? 'font-semibold text-red-600' : 'text-gray-500'}>
                      {r.status === 'sent' ? 'Enviado' : r.status === 'failed' ? 'Falló' : 'Omitido'}{r.error ? ` · ${r.error}` : ''}{r.resend_id ? ` · ${r.resend_id}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex justify-end"><button onClick={onClose} className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-bold text-white">Cerrar</button></div>
            </div>
          ) : (
            <>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-gray-500">Plantilla</label>
                <select value={key} onChange={e => pick(e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm">
                  {templates.map(t => <option key={t.key} value={t.key}>{t.name}</option>)}
                </select>
                {tpl && (
                  <p className={`mt-1.5 text-xs ${tpl.kind === 'assistance' ? 'text-emerald-700' : 'text-amber-700'}`}>
                    {tpl.kind === 'assistance'
                      ? 'Asistencia por problema de pago: no depende de bajas ni preferencias de campañas.'
                      : 'Comercial: respeta bajas, excluye casos con cobro sin verificar y lleva link de baja.'}
                  </p>
                )}
              </div>
              <div><label className="mb-1.5 block text-xs font-semibold text-gray-500">Asunto</label>
                <input value={subject} onChange={e => { setSubject(e.target.value); setItems(null) }} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" /></div>
              <div><label className="mb-1.5 block text-xs font-semibold text-gray-500">Mensaje · variables: {'{{nombre}}'} {'{{plan_url}}'}</label>
                <textarea value={body} onChange={e => { setBody(e.target.value); setItems(null) }} rows={8} className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2.5 text-sm" /></div>
              <div className="flex flex-wrap justify-end gap-2">
                <button onClick={() => void saveTemplate()} disabled={busy || !tpl || (tpl.subject === subject && tpl.body === body)} className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40">Guardar cambios en la plantilla</button>
                <button onClick={() => void preview()} disabled={busy || !subject.trim() || !body.trim()} className="flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-50">
                  {busy && !items ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Ver vista previa
                </button>
              </div>

              {items && (
                <div className="space-y-3" data-testid="followup-preview">
                  <h3 className="text-sm font-bold text-gray-900">Vista previa · {eligible.length} de {items.length} se enviarán</h3>
                  {items.map(i => (
                    <div key={i.influencer_id} className={`rounded-xl border p-3 text-sm ${i.eligible ? 'border-gray-200' : 'border-gray-100 bg-gray-50 text-gray-500'}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold text-gray-900">{i.name}</div>
                          <div className="text-xs text-gray-500">Intentos Pro: {i.attempts}{i.unverified_charge ? ' · cobro sin verificar' : ''}{i.last_sent ? ` · último envío ${new Date(i.last_sent.created_at).toLocaleDateString('es-CL')}` : ''}</div>
                        </div>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${i.eligible ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-200 text-gray-600'}`}>{i.eligible ? 'Se enviará' : `No se envía: ${i.reason}`}</span>
                      </div>
                      {i.eligible && (
                        <dl className="mt-2 space-y-1 text-xs">
                          <div><dt className="inline font-semibold">De: </dt><dd className="inline">{i.from}</dd></div>
                          <div><dt className="inline font-semibold">Para: </dt><dd className="inline">{i.to}</dd></div>
                          <div><dt className="inline font-semibold">Asunto: </dt><dd className="inline">{i.subject}</dd></div>
                          <pre className="whitespace-pre-wrap rounded-lg bg-gray-50 p-2 font-sans text-gray-700">Hola {i.name},{'\n\n'}{i.body}</pre>
                          <div><dt className="font-semibold">Enlaces:</dt>{i.links.map(l => <dd key={l} className="break-all text-violet-700">{l}</dd>)}</div>
                        </dl>
                      )}
                      <div className="mt-2 flex gap-3 text-xs">
                        <button onClick={() => void toggleHistory(i.influencer_id)} className="flex items-center gap-1 text-gray-500 hover:text-gray-800"><History className="h-3 w-3" /> Historial</button>
                        {tpl?.kind === 'commercial' && <button onClick={() => void optout(i.influencer_id)} className="flex items-center gap-1 text-gray-500 hover:text-red-600"><ShieldAlert className="h-3 w-3" /> Registrar baja comercial</button>}
                      </div>
                      {openId === i.influencer_id && (
                        <ul className="mt-2 space-y-1 border-t border-gray-100 pt-2 text-xs">
                          {(history[i.influencer_id] ?? []).length === 0 && <li className="text-gray-400">Sin envíos previos.</li>}
                          {(history[i.influencer_id] ?? []).map(h => <li key={h.id}>{new Date(h.created_at).toLocaleString('es-CL')} · {h.template_key} · {h.status}{h.error ? ` (${h.error})` : ''}{h.resend_id ? ` · ${h.resend_id}` : ''}</li>)}
                        </ul>
                      )}
                    </div>
                  ))}
                  {eligible.length > 0 && (
                    <div className="rounded-xl border border-violet-200 bg-violet-50 p-3">
                      <label className="flex items-start gap-2 text-sm text-gray-800">
                        <input type="checkbox" checked={confirm} onChange={e => setConfirm(e.target.checked)} className="mt-1" data-testid="followup-confirm" />
                        Confirmo que revisé el mensaje y quiero enviarlo ahora a {eligible.length} persona(s).
                      </label>
                      <div className="mt-3 flex justify-end">
                        <button onClick={() => void send()} disabled={!confirm || busy} data-testid="followup-send" className="flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-40">
                          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Enviar a {eligible.length}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
