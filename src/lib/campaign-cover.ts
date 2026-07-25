import { createAdminClient } from '@/lib/supabase/server'

const BUCKET = 'campaign-assets'

type StoredAsset = {
  campaign_id: string | null
  storage_path: string | null
  metadata: Record<string, unknown> | null
}

/** Returns the single current banner of each campaign, stored as an asset. */
export async function getCampaignCoverUrls(
  admin: ReturnType<typeof createAdminClient>,
  campaignIds: string[],
) {
  const ids = Array.from(new Set(campaignIds.filter(Boolean)))
  if (ids.length === 0) return new Map<string, string>()

  const { data } = await admin
    .from('media_files')
    .select('campaign_id, storage_path, metadata, created_at')
    .in('campaign_id', ids)
    .is('deliverable_id', null)
    .order('created_at', { ascending: false })

  const latest = new Map<string, StoredAsset>()
  for (const asset of (data ?? []) as StoredAsset[]) {
    if (!asset.campaign_id || !asset.storage_path || asset.metadata?.asset_type !== 'campaign_cover' || latest.has(asset.campaign_id)) continue
    latest.set(asset.campaign_id, asset)
  }

  const result = new Map<string, string>()
  await Promise.all(Array.from(latest.entries()).map(async ([campaignId, asset]) => {
    if (asset.metadata?.kind === 'external_url') {
      result.set(campaignId, asset.storage_path!)
      return
    }
    const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(asset.storage_path!, 60 * 60)
    if (signed?.signedUrl) result.set(campaignId, signed.signedUrl)
  }))
  return result
}
