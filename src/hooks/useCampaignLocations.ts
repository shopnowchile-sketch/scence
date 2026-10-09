'use client'

import { useCallback, useEffect, useState } from 'react'
import type { PlaceSelection } from '@/components/locations/PhysicalLocationPicker'

/** Una dirección de campaña tal como la devuelve /api/campaigns/[id]/locations. */
export type CampaignLocationItem = {
  id: string
  location_id: string
  is_primary: boolean
  instructions: string | null
  name: string
  address: string | null
  commune: string | null
  region: string | null
  country: string | null
}

/** Direcciones elegidas mientras la campaña todavía no existe (se envían al crearla). */
export type PendingCampaignLocation = Omit<CampaignLocationItem, 'id'>

export function placeToPending(place: PlaceSelection, isFirst: boolean): PendingCampaignLocation {
  return {
    location_id: place.locationId, is_primary: isFirst, instructions: null,
    name: place.name, address: place.address, commune: place.commune, region: place.region, country: place.country,
  }
}

async function call(url: string, init?: RequestInit): Promise<CampaignLocationItem[]> {
  const res = await fetch(url, { credentials: 'same-origin', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error ?? 'No se pudo guardar la dirección')
  return (json.data ?? []) as CampaignLocationItem[]
}

/**
 * Envía a la campaña recién creada las direcciones elegidas antes de que existiera.
 * Devuelve las que NO se pudieron guardar (para no perderlas ni reintentar las ya guardadas).
 */
export async function savePendingCampaignLocations(campaignId: string, pending: PendingCampaignLocation[]): Promise<PendingCampaignLocation[]> {
  const failed: PendingCampaignLocation[] = []
  for (const item of pending) {
    try {
      await call(`/api/campaigns/${campaignId}/locations`, {
        method: 'POST',
        body: JSON.stringify({ location_id: item.location_id, instructions: item.instructions, is_primary: item.is_primary }),
      })
    } catch (e) {
      // 409 = ya estaba asociada (reintento tras un guardado parcial): no es un fallo.
      if (!(e instanceof Error && e.message.includes('ya está asociada'))) failed.push(item)
    }
  }
  return failed
}

export function useCampaignLocations(campaignId: string | null) {
  const [items, setItems] = useState<CampaignLocationItem[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!campaignId) { setItems([]); return }
    setLoading(true); setError(null)
    try { setItems(await call(`/api/campaigns/${campaignId}/locations`)) }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudieron cargar las direcciones') }
    finally { setLoading(false) }
  }, [campaignId])

  useEffect(() => { void reload() }, [reload])

  const mutate = useCallback(async (run: () => Promise<CampaignLocationItem[]>) => {
    setBusy(true); setError(null)
    try { const next = await run(); setItems(next); return true }
    catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar la dirección')
      // El servidor pudo guardar y fallar después (sincronización): mostrar el estado real.
      try { setItems(await call(`/api/campaigns/${campaignId}/locations`)) } catch { /* se conserva el error original */ }
      return false
    }
    finally { setBusy(false) }
  }, [])

  const base = `/api/campaigns/${campaignId}/locations`
  return {
    items, loading, busy, error, reload,
    add: (place: PlaceSelection) => mutate(() => call(base, { method: 'POST', body: JSON.stringify({ location_id: place.locationId }) })),
    remove: (linkId: string) => mutate(() => call(`${base}/${linkId}`, { method: 'DELETE' })),
    makePrimary: (linkId: string) => mutate(() => call(`${base}/${linkId}`, { method: 'PATCH', body: JSON.stringify({ is_primary: true }) })),
    saveInstructions: (linkId: string, instructions: string) => mutate(() => call(`${base}/${linkId}`, { method: 'PATCH', body: JSON.stringify({ instructions }) })),
  }
}
