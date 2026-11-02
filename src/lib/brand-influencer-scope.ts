import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/supabase/fetchAllRows'

// Regla global de privacidad (2026-11-02): una marca solo ve influencers con una relación comprobable con ELLA:
//   1. postularon, fueron invitadas o participaron en una campaña propia/creada por la marca (cualquier estado,
//      incluida rechazada);
//   2. están vinculadas a una campaña en la que la marca colabora (campaign_brands);
//   3. figuran en el roster propio (brand_influencers).
// `brand_collaborators` (marcas colaboradoras persistentes) NO concede acceso: solo campaign_brands por campaña.
// Fuente única: todo endpoint de marca que liste, busque o abra influencers debe pasar por aquí.
export async function getBrandInfluencerScope(
  admin: SupabaseClient,
  brandId: string,
): Promise<{ influencerIds: Set<string>; campaignIds: string[]; error: string | null }> {
  const fail = (message: string) => ({ influencerIds: new Set<string>(), campaignIds: [], error: message })

  const [owned, collaborating, roster] = await Promise.all([
    admin.from('campaigns').select('id').or(`brand_id.eq.${brandId},created_by_brand_id.eq.${brandId}`),
    admin.from('campaign_brands').select('campaign_id').eq('brand_id', brandId),
    admin.from('brand_influencers').select('influencer_id').eq('brand_id', brandId),
  ])
  if (owned.error) return fail(owned.error.message)
  if (collaborating.error) return fail(collaborating.error.message)
  if (roster.error) return fail(roster.error.message)

  const campaignIds = Array.from(new Set([
    ...(owned.data ?? []).map(row => row.id),
    ...(collaborating.data ?? []).map(row => row.campaign_id),
  ].filter(Boolean))) as string[]

  const influencerIds = new Set<string>((roster.data ?? []).map(row => row.influencer_id).filter(Boolean))

  // Por lotes de campañas: .in() con cientos de ids revienta el largo de la URL de PostgREST.
  for (let i = 0; i < campaignIds.length; i += 100) {
    const batch = campaignIds.slice(i, i + 100)
    const { data, error } = await fetchAllRows<{ influencer_id: string | null }>(
      (from, to) => admin.from('campaign_influencers').select('influencer_id').in('campaign_id', batch).range(from, to),
      { maxRows: 50000 },
    )
    if (error) return fail((error as { message?: string }).message ?? 'Error cargando relaciones')
    for (const row of data) if (row.influencer_id) influencerIds.add(row.influencer_id)
  }

  return { influencerIds, campaignIds, error: null }
}
