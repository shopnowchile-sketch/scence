import type { SupabaseClient } from '@supabase/supabase-js'
import { loadCampaignLocations } from '@/lib/campaign-locations'

type Crumb = { id: string; level: string }
const idOf = (b: unknown, level: string) => (Array.isArray(b) ? (b as Crumb[]).find(i => i.level === level)?.id : undefined) ?? null

/**
 * Sugiere la dirección de envío más cercana a la campaña: misma comuna > misma región.
 * Cercanía administrativa (no distancia): sin coordenadas ni geografía suficiente devuelve null.
 * Es solo una ayuda; la influencer decide siempre.
 */
export async function suggestShippingAddress(admin: SupabaseClient, campaignId: string, addresses: Array<{ id: string }>): Promise<string | null> {
  if (!addresses.length) return null
  const primary = (await loadCampaignLocations(admin, campaignId))[0]
  if (!primary) return null
  const { data: target } = await admin.rpc('location_breadcrumb', { p_id: primary.location_id })
  const tCommune = idOf(target, 'commune'), tRegion = idOf(target, 'region')
  if (!tCommune && !tRegion) return null
  let sameRegion: string | null = null
  for (const a of addresses) {
    const { data: bc } = await admin.rpc('location_breadcrumb', { p_id: a.id })
    if (tCommune && idOf(bc, 'commune') === tCommune) return a.id
    if (!sameRegion && tRegion && idOf(bc, 'region') === tRegion) sameRegion = a.id
  }
  return sameRegion
}
