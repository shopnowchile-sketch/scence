'use client'

import { useEffect, useMemo, useState } from 'react'
import { Gift, ChevronDown, ChevronRight, Clock, AlertTriangle, Check, ExternalLink, Loader2 } from 'lucide-react'
import { cn, formatCurrency, formatDatetime } from '@/lib/utils'
import { BARTER_FLOW, BARTER_STATUS_CONFIG, type Barter, type BarterStatus } from '@/types'

/**
 * Vista de solo lectura de canjes. Reutilizable en portal marca e influencer.
 * Carga desde un endpoint scoped por ownership (no expone canjes de terceros).
 */
export function BartersReadonly({ endpoint }: { endpoint: string }) {
  const [barters, setBarters] = useState<Barter[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const res = await fetch(endpoint)
        if (!res.ok) throw new Error()
        const json = await res.json()
        if (active) setBarters(json.data ?? [])
      } catch {
        if (active) setBarters([])
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [endpoint])

  const kpis = useMemo(() => {
    let value = 0, closed = 0
    for (const b of barters) { value += b.estimated_value ?? 0; if (b.status === 'cerrado') closed += 1 }
    return { value, closed, pct: barters.length ? Math.round((closed / barters.length) * 100) : 0 }
  }, [barters])

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <div className="flex items-center gap-2 text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin" /> <span className="text-sm">Cargando canjes…</span>
        </div>
      </div>
    )
  }

  if (barters.length === 0) return null // no mostrar la sección si no hay canjes

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-gray-700 flex items-center gap-2">
          <Gift className="h-4 w-4 text-violet-500" /> Canjes ({barters.length})
        </h2>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span>{formatCurrency(kpis.value, 'CLP')} en valor</span>
          <span className="text-emerald-600 font-semibold">{kpis.pct}% cerrados</span>
        </div>
      </div>

      <div className="space-y-3">
        {barters.map(b => <ReadonlyBarterCard key={b.id} barter={b} />)}
      </div>
    </div>
  )
}

function ReadonlyBarterCard({ barter: b }: { barter: Barter }) {
  const [showHistory, setShowHistory] = useState(false)
  const cfg = BARTER_STATUS_CONFIG[b.status]
  const flowIdx = BARTER_FLOW.indexOf(b.status)
  const isProblem = b.status === 'con_problema'

  return (
    <div className={cn('rounded-xl border border-gray-100 p-4 border-l-4',
      isProblem ? 'border-l-red-400' : b.status === 'cerrado' ? 'border-l-emerald-400' : 'border-l-violet-300')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{b.item}</p>
          <p className="text-xs text-gray-500">
            {b.influencer?.display_name ?? ''}
            {b.estimated_value ? ` · ${formatCurrency(b.estimated_value, b.currency)}` : ''}
          </p>
        </div>
        <span className={cn('px-2.5 py-1 rounded-md text-xs font-semibold shrink-0', cfg.badge)}>{cfg.label}</span>
      </div>

      {/* Timeline */}
      <div className="mt-3 flex items-center">
        {BARTER_FLOW.map((s, i) => {
          const done = !isProblem && flowIdx >= i
          return (
            <div key={s} className="flex items-center flex-1 last:flex-none">
              <div className={cn('h-4 w-4 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0',
                done ? 'bg-violet-600 text-white' : 'bg-gray-200 text-gray-400')}>
                {done ? <Check className="h-2.5 w-2.5" /> : i + 1}
              </div>
              {i < BARTER_FLOW.length - 1 && (
                <div className={cn('h-0.5 flex-1', done && flowIdx > i ? 'bg-violet-600' : 'bg-gray-200')} />
              )}
            </div>
          )
        })}
      </div>
      {isProblem && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-red-600 font-medium">
          <AlertTriangle className="h-3.5 w-3.5" /> Canje con problema.
        </div>
      )}

      {b.evidence_url && (
        <a href={b.evidence_url} target="_blank" rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-xs text-violet-600 hover:text-violet-700">
          <ExternalLink className="h-3.5 w-3.5" /> Ver evidencia
        </a>
      )}

      <button onClick={() => setShowHistory(v => !v)}
        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-gray-600">
        {showHistory ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        Historial ({b.history?.length ?? 0})
      </button>

      {showHistory && (
        <div className="mt-2 pt-2 border-t border-gray-100 space-y-1.5">
          {(b.history ?? []).map(h => (
            <div key={h.id} className="flex items-start gap-2 text-xs">
              <Clock className="h-3 w-3 text-gray-300 mt-0.5 shrink-0" />
              <span className="text-gray-600">
                {h.from_status ? `${BARTER_STATUS_CONFIG[h.from_status].label} → ` : ''}
                <span className="font-medium text-gray-700">{BARTER_STATUS_CONFIG[h.to_status].label}</span>
                <span className="text-gray-400"> · {formatDatetime(h.created_at)}</span>
                {h.note && <span className="block text-gray-500">“{h.note}”</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
