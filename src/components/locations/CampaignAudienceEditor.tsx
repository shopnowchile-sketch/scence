'use client'

// Segmentación geográfica: dónde se muestra la campaña. Sin zonas = todas las influencers.
// Una sola pieza para Admin y Marca, en creación (sin id → zonas pendientes que el formulario
// guarda al crear) y en edición (API directa). Reutiliza el catálogo `locations`.
import { useEffect, useRef, useState } from 'react'
import { Globe2, Loader2, X } from 'lucide-react'
import { latamCountryIds } from '@/lib/campaign-audience-latam'

export type AudienceZone = { id: string; name: string; level: string; parent?: string | null }

type Props = {
  campaignId: string | null
  canEdit?: boolean
  /** Solo creación (campaignId = null). */
  pending?: AudienceZone[]
  onPendingChange?: (next: AudienceZone[]) => void
}

type Hit = { id: string; name: string; level: string; region: string | null; country: string | null; breadcrumb: string }

const LEVEL_LABEL: Record<string, string> = { country: 'País', region: 'Región', city: 'Ciudad', commune: 'Comuna' }

/** Guarda las zonas elegidas antes de que existiera la campaña. Devuelve true si se guardaron. */
export async function savePendingCampaignAudience(campaignId: string, zones: AudienceZone[]): Promise<boolean> {
  if (!zones.length) return true
  const res = await fetch(`/api/campaigns/${campaignId}/audience`, {
    method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ location_ids: zones.map(z => z.id) }),
  })
  return res.ok
}

export function CampaignAudienceEditor({ campaignId, canEdit = true, pending = [], onPendingChange }: Props) {
  const isServer = Boolean(campaignId)
  const [serverZones, setServerZones] = useState<AudienceZone[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const timer = useRef<ReturnType<typeof setTimeout>>()

  const zones = isServer ? serverZones : pending

  useEffect(() => {
    if (!campaignId) return
    let alive = true
    setBusy(true)
    fetch(`/api/campaigns/${campaignId}/audience`, { credentials: 'same-origin' })
      .then(r => r.json().then(j => ({ ok: r.ok, j })))
      .then(({ ok, j }) => { if (alive) { if (ok) setServerZones(j.data ?? []); else setError(j.error ?? 'No se pudo cargar') } })
      .catch(() => { if (alive) setError('No se pudo cargar') })
      .finally(() => { if (alive) setBusy(false) })
    return () => { alive = false }
  }, [campaignId])

  useEffect(() => {
    clearTimeout(timer.current)
    if (q.trim().length < 2) { setHits([]); return }
    timer.current = setTimeout(() => {
      fetch(`/api/influencer/locations?q=${encodeURIComponent(q.trim())}`, { credentials: 'same-origin' })
        .then(r => r.json()).then(j => setHits((j.data ?? []).slice(0, 8))).catch(() => setHits([]))
    }, 200)
    return () => clearTimeout(timer.current)
  }, [q])

  async function commit(next: AudienceZone[]) {
    if (!isServer) { onPendingChange?.(next); return }
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/audience`, {
        method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location_ids: next.map(z => z.id) }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'No se pudo guardar')
      setServerZones(json.data ?? next)
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar') }
    finally { setBusy(false) }
  }

  const add = (zone: AudienceZone) => { if (!zones.some(z => z.id === zone.id)) void commit([...zones, zone]); setQ(''); setHits([]) }
  const remove = (id: string) => void commit(zones.filter(z => z.id !== id))

  async function addLatam() {
    setError(null)
    try {
      const res = await fetch('/api/influencer/locations?level=country', { credentials: 'same-origin' })
      const json = await res.json()
      const countries: Hit[] = json.data ?? []
      const ids = new Set(latamCountryIds(countries.map(c => ({ id: c.id, level: c.level, name: c.name }))))
      const merged = [...zones]
      for (const c of countries) if (ids.has(c.id) && !merged.some(z => z.id === c.id)) merged.push({ id: c.id, name: c.name, level: 'country' })
      await commit(merged)
    } catch { setError('No se pudo cargar LATAM') }
  }

  return (
    <div className="space-y-2" data-testid="campaign-audience-editor">
      <div className="flex flex-wrap items-center gap-1.5">
        {zones.length === 0 && <span className="text-xs text-gray-500">Todas las influencers (sin restricción)</span>}
        {zones.map(z => (
          <span key={z.id} className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-800">
            {z.name}<span className="text-[10px] text-violet-500">{LEVEL_LABEL[z.level] ?? z.level}</span>
            {canEdit && <button type="button" onClick={() => remove(z.id)} disabled={busy} aria-label={`Quitar ${z.name}`} className="rounded-full p-0.5 hover:bg-violet-100"><X className="h-3 w-3" /></button>}
          </span>
        ))}
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />}
      </div>

      {canEdit && (
        <div className="relative flex items-center gap-2">
          <input
            value={q} onChange={e => setQ(e.target.value)}
            placeholder="Agregar comuna, región o país…" aria-label="Agregar zona"
            className="input-base w-full !py-1.5 text-sm"
          />
          <button type="button" onClick={() => void addLatam()} disabled={busy}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-violet-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-50">
            <Globe2 className="h-3 w-3" /> LATAM
          </button>
          {hits.length > 0 && (
            <ul className="absolute left-0 top-full z-30 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
              {hits.map(h => (
                <li key={h.id}>
                  <button type="button" onClick={() => add({ id: h.id, name: h.name, level: h.level, parent: h.region ?? h.country })}
                    className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-violet-50">
                    <span className="truncate">{h.name}{h.level === 'commune' && h.region ? <span className="text-gray-400"> · {h.region}</span> : null}</span>
                    <span className="shrink-0 text-[10px] text-gray-400">{LEVEL_LABEL[h.level] ?? h.level}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}
