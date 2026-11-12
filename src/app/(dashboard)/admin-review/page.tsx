'use client'

// Contenido por revisar: todo lo que espera revisión en una sola lista, con aprobar y rechazar en la misma fila.
// Usa el mismo PATCH que la pestaña de entregables de cada campaña (/api/campaigns/[id]/deliverables).
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Check, ExternalLink, Loader2, X } from 'lucide-react'

type Item = {
  id: string; title: string | null; type: string | null; platform: string | null; due_date: string | null
  content_url: string | null; published_url: string | null; submitted_at: string | null; submitted_notes: string | null
  campaign_id: string
  influencer: { id: string; user_name: string | null; avatar_url: string | null } | null
  campaign: { id: string; name: string | null; brand: { name: string | null } | null } | null
}

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null)
const day = (v: string | null) => (v ? new Date(v).toLocaleDateString('es-CL', { day: '2-digit', month: 'short' }) : '—')

export default function ContentReviewPage() {
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [note, setNote] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/content-review', { credentials: 'same-origin' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'No se pudo cargar')
      setItems((json.data ?? []).map((r: Item) => ({ ...r, influencer: one(r.influencer), campaign: r.campaign ? { ...one(r.campaign)!, brand: one(one(r.campaign)?.brand) } : null })))
    } catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo cargar') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  async function review(item: Item, action: 'approve' | 'reject', notes?: string) {
    setBusy(prev => new Set(prev).add(item.id))
    try {
      const res = await fetch(`/api/campaigns/${item.campaign_id}/deliverables`, {
        method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deliverable_id: item.id, action, ...(notes ? { review_notes: notes } : {}) }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'No se pudo guardar')
      setItems(prev => prev.filter(i => i.id !== item.id))
      setSelected(prev => { const next = new Set(prev); next.delete(item.id); return next })
      return true
    } catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo guardar'); return false }
    finally { setBusy(prev => { const next = new Set(prev); next.delete(item.id); return next }) }
  }

  async function approveSelected() {
    const chosen = items.filter(i => selected.has(i.id))
    if (!chosen.length || !confirm(`¿Aprobar ${chosen.length} contenido(s)?`)) return
    let ok = 0
    for (const item of chosen) if (await review(item, 'approve')) ok++
    toast.success(`${ok} aprobado(s)`)
  }

  const toggle = (id: string) => setSelected(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })

  return (
    <div className="space-y-4" data-testid="content-review">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Contenido por revisar</h1>
          <p className="text-sm text-gray-400">{loading ? 'Cargando…' : `${items.length} entregable${items.length === 1 ? '' : 's'} esperando revisión`} · del más antiguo al más nuevo</p>
        </div>
        {selected.size > 0 && (
          <button onClick={() => void approveSelected()} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
            <Check className="h-4 w-4" /> Aprobar {selected.size} seleccionado{selected.size === 1 ? '' : 's'}
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-gray-50 text-left text-xs text-gray-400">
              <th className="w-10 px-4 py-3">
                <input type="checkbox" aria-label="Seleccionar todos" className="h-4 w-4 rounded border-gray-300 text-violet-600"
                  checked={items.length > 0 && selected.size === items.length}
                  onChange={() => setSelected(selected.size === items.length ? new Set() : new Set(items.map(i => i.id)))} />
              </th>
              <th className="px-4 py-3 font-semibold">Influencer</th>
              <th className="px-4 py-3 font-semibold">Campaña</th>
              <th className="px-4 py-3 font-semibold">Entregable</th>
              <th className="px-4 py-3 font-semibold">Contenido</th>
              <th className="px-4 py-3 font-semibold">Enviado</th>
              <th className="px-4 py-3 text-right font-semibold">Revisar</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></td></tr>}
            {!loading && items.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">No hay contenido esperando revisión 🎉</td></tr>}
            {items.map(item => {
              const url = item.content_url || item.published_url
              const working = busy.has(item.id)
              return (
                <tr key={item.id} className="border-b border-gray-50 align-top last:border-0">
                  <td className="px-4 py-3"><input type="checkbox" aria-label="Seleccionar" className="h-4 w-4 rounded border-gray-300 text-violet-600" checked={selected.has(item.id)} onChange={() => toggle(item.id)} /></td>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {item.influencer ? <Link href={`/admin-influencers/${item.influencer.id}`} className="hover:underline">{item.influencer.user_name ?? '—'}</Link> : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    <Link href={`/admin-campaigns/${item.campaign_id}?tab=deliverables`} className="hover:underline">{item.campaign?.name ?? 'Campaña'}</Link>
                    {item.campaign?.brand?.name && <div className="text-xs text-gray-400">{item.campaign.brand.name}</div>}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    <div>{item.title || item.type || 'Entregable'}</div>
                    <div className="text-xs capitalize text-gray-400">{[item.type, item.platform].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td className="px-4 py-3">
                    {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-violet-600 hover:underline">Ver contenido <ExternalLink className="h-3 w-3" /></a> : <span className="text-gray-400">Sin link</span>}
                    {item.submitted_notes && <div className="mt-0.5 max-w-[220px] truncate text-xs text-gray-400" title={item.submitted_notes}>{item.submitted_notes}</div>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-500">{day(item.submitted_at)}</td>
                  <td className="px-4 py-3">
                    {rejecting === item.id ? (
                      <div className="flex flex-col items-end gap-2">
                        <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="¿Qué debe corregir? (se le envía a la influencer)" className="w-64 resize-none rounded-lg border border-gray-200 px-2 py-1.5 text-xs outline-none focus:border-violet-400" autoFocus />
                        <div className="flex gap-2">
                          <button onClick={() => { setRejecting(null); setNote('') }} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50">Cancelar</button>
                          <button disabled={working || !note.trim()} onClick={async () => { if (await review(item, 'reject', note.trim())) { setRejecting(null); setNote('') } }} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-40">Enviar rechazo</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex justify-end gap-2">
                        <button disabled={working} onClick={() => { setRejecting(item.id); setNote('') }} className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-40"><X className="h-3.5 w-3.5" /> Rechazar</button>
                        <button disabled={working} onClick={() => void review(item, 'approve')} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40">{working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Aprobar</button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
