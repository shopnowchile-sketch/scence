'use client'

// Direcciones de una campaña: agregar, consultar, quitar, elegir la principal.
// Una sola pieza para Admin y Marca, en creación (campaña aún sin id → lista
// pendiente que el formulario envía al crearla) y en edición (API directa).
import { useState } from 'react'
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

export function CampaignLocationsEditor({ campaignId, portal, brandId = null, canEdit = true, pending = [], onPendingChange, onChanged }: Props) {
  const server = useCampaignLocations(campaignId)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const isServer = Boolean(campaignId)

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
