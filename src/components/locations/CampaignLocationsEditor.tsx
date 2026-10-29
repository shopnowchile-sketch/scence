'use client'

// Direcciones de una campaña: agregar, consultar, quitar, elegir la principal.
// Una sola pieza para Admin y Marca, en creación (campaña aún sin id → lista
// pendiente que el formulario envía al crearla) y en edición (API directa).
import { useEffect, useRef, useState } from 'react'
import { Loader2, MapPin, Star, X } from 'lucide-react'
import { PhysicalLocationPicker, type PlaceSelection } from './PhysicalLocationPicker'
import {
  placeToPending,
  useCampaignLocations,
  type CampaignLocationItem,
  type PendingCampaignLocation,
} from '@/hooks/useCampaignLocations'

type Props = {
  campaignId: string | null
  portal: 'admin' | 'brand'
  /** Admin: marca de la campaña; los lugares nuevos quedan a su nombre. */
  brandId?: string | null
  canEdit?: boolean
  /** Solo creación (campaignId = null). */
  pending?: PendingCampaignLocation[]
  onPendingChange?: (next: PendingCampaignLocation[]) => void
  /** Tras cualquier cambio guardado en el servidor (para refrescar la ficha). */
  onChanged?: () => void
}

type Row = { key: string; item: PendingCampaignLocation | CampaignLocationItem }

type BrandPlace = {
  id: string; name: string; address?: string | null; type?: string | null
  city?: string | null; region?: string | null; country?: string | null
  breadcrumb?: { level: string; name: string }[]
}
const TYPE_RANK: Record<string, number> = { brand_venue: 0, showroom: 1, store: 2 }

/** Lugar por defecto de una campaña nueva: la sede de la marca con dirección (o su local más representativo). */
async function fetchBrandDefaultPlace(portal: 'admin' | 'brand', brandId: string | null): Promise<PlaceSelection | null> {
  const url = portal === 'brand' ? '/api/brand/locations?mine=1' : brandId ? `/api/brands/${brandId}/locations` : null
  if (!url) return null
  try {
    const res = await fetch(url, { credentials: 'same-origin' })
    if (!res.ok) return null
    const json = await res.json()
    const places = ((json.data ?? []) as BrandPlace[])
      .filter(p => p.type !== 'influencer_home')
      .sort((a, b) => Number(!a.address?.trim()) - Number(!b.address?.trim()) || (TYPE_RANK[a.type ?? ''] ?? 9) - (TYPE_RANK[b.type ?? ''] ?? 9) || a.name.localeCompare(b.name, 'es'))
    const place = places[0]
    if (!place) return null
    const by = (level: string) => place.breadcrumb?.find(i => i.level === level)?.name ?? null
    return {
      locationId: place.id, name: place.name, address: place.address ?? null,
      commune: by('commune') ?? place.city ?? null, region: by('region') ?? place.region ?? null, country: by('country') ?? place.country ?? null,
    }
  } catch { return null }
}

export function CampaignLocationsEditor({ campaignId, portal, brandId = null, canEdit = true, pending = [], onPendingChange, onChanged }: Props) {
  const server = useCampaignLocations(campaignId)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const isServer = Boolean(campaignId)

  // Campaña nueva: la dirección por defecto es la de la marca. Solo se propone si no hay nada elegido
  // (o si lo único elegido es la propuesta anterior y cambió la marca); quitarla a mano se respeta.
  const autoPlaceId = useRef<string | null>(null)
  useEffect(() => {
    if (isServer || !canEdit) return
    if (portal === 'admin' && !brandId) return
    let alive = true
    void fetchBrandDefaultPlace(portal, brandId ?? null).then(place => {
      if (!alive || !place) return
      const onlyAuto = pending.length === 0 || (pending.length === 1 && pending[0].location_id === autoPlaceId.current)
      if (!onlyAuto || pending[0]?.location_id === place.locationId) return
      if (pending.length === 0 && autoPlaceId.current === place.locationId) return
      autoPlaceId.current = place.locationId
      onPendingChange?.([placeToPending(place, true)])
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isServer, canEdit, portal, brandId])

  const rows: Row[] = isServer
    ? server.items.map(item => ({ key: item.id, item }))
    : pending.map(item => ({ key: item.location_id, item }))
  const busy = isServer && (server.busy || server.loading)

  async function add(place: PlaceSelection) {
    if (isServer) { await server.add(place); onChanged?.(); return }
    if (pending.some(p => p.location_id === place.locationId)) return
    onPendingChange?.([...pending, placeToPending(place, pending.length === 0)])
  }

  async function remove(row: Row) {
    if (isServer) { await server.remove(row.key); onChanged?.(); return }
    const next = pending.filter(p => p.location_id !== row.key)
    if (next.length && !next.some(p => p.is_primary)) next[0] = { ...next[0], is_primary: true }
    onPendingChange?.(next)
  }

  async function makePrimary(row: Row) {
    if (isServer) { await server.makePrimary(row.key); onChanged?.(); return }
    onPendingChange?.(pending.map(p => ({ ...p, is_primary: p.location_id === row.key })))
  }

  async function saveInstructions(row: Row) {
    const text = (draft[row.key] ?? row.item.instructions ?? '').trim()
    if (text === (row.item.instructions ?? '')) return
    if (isServer) { await server.saveInstructions(row.key, text); onChanged?.(); return }
    onPendingChange?.(pending.map(p => p.location_id === row.key ? { ...p, instructions: text || null } : p))
  }

  return (
    <div className="space-y-3">
      {server.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{server.error}</p>}

      {rows.length === 0 ? (
        <p className="text-sm text-gray-400">{server.loading ? 'Cargando…' : 'Sin direcciones asociadas todavía.'}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map(row => {
            const { item } = row
            const geo = [item.commune, item.region].filter(Boolean).join(', ')
            return (
              <li key={row.key} className={`rounded-xl border p-3 ${item.is_primary ? 'border-violet-200 bg-violet-50/40' : 'border-gray-100 bg-white'}`}>
                <div className="flex items-start gap-3">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold text-gray-900">{item.name}</p>
                      {item.is_primary && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700">Principal</span>}
                    </div>
                    <p className="mt-0.5 text-xs text-gray-600">{[item.address, geo].filter(Boolean).join(' · ') || 'Sin dirección'}</p>
                    {canEdit ? (
                      <input
                        value={draft[row.key] ?? item.instructions ?? ''}
                        onChange={e => setDraft(d => ({ ...d, [row.key]: e.target.value }))}
                        onBlur={() => void saveInstructions(row)}
                        maxLength={500}
                        placeholder="Indicaciones de llegada (opcional)"
                        aria-label={`Indicaciones de ${item.name}`}
                        className="input-base mt-2 w-full !py-1.5 text-xs"
                      />
                    ) : item.instructions ? <p className="mt-2 text-xs text-gray-400">{item.instructions}</p> : null}
                  </div>
                  {canEdit && (
                    <div className="flex shrink-0 items-center gap-1">
                      {!item.is_primary && (
                        <button type="button" onClick={() => void makePrimary(row)} disabled={busy} title="Hacer principal" aria-label={`Hacer principal ${item.name}`}
                          className="rounded p-1.5 text-gray-400 hover:bg-violet-50 hover:text-violet-700 disabled:opacity-50"><Star className="h-4 w-4" /></button>
                      )}
                      <button type="button" onClick={() => void remove(row)} disabled={busy} title="Quitar dirección" aria-label={`Quitar ${item.name}`}
                        className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"><X className="h-4 w-4" /></button>
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {canEdit && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-semibold text-gray-700">
            {rows.length ? 'Agregar otra dirección' : 'Agregar dirección'}
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" aria-hidden />}
          </div>
          <PhysicalLocationPicker
            apiBase={portal === 'brand' ? '/api/brand/locations' : '/api/locations'}
            brandId={brandId}
            excludeIds={rows.map(r => r.item.location_id)}
            disabled={busy}
            onSelect={place => void add(place)}
          />
        </div>
      )}
    </div>
  )
}
