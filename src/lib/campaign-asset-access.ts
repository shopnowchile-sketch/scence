import { createAdminClient } from '@/lib/supabase/server'
import { getOrgId, getUserRole, resolveBrandAccess } from '@/lib/supabase/ensureOrg'

export async function resolveCampaignAssetAccess(
  userId: string,
  userMetadata: Record<string, unknown>,
  campaignId: string,
) {
  const admin = createAdminClient()
  const { data: campaign, error } = await admin
    .from('campaigns')
    .select('id, organization_id, brand_id, created_by_brand_id')
    .eq('id', campaignId)
    .maybeSingle()

  if (error) throw error
  if (!campaign) return { admin, campaign: null, canView: false, canManage: false }

  const orgId = await getOrgId(userId, userMetadata, admin)
  const { isAdmin } = orgId ? await getUserRole(userId, orgId, admin) : { isAdmin: false }
  if (isAdmin) return { admin, campaign, canView: true, canManage: true }

  if (userMetadata?.is_brand) {
    const access = await resolveBrandAccess(userId)
    if (!access) return { admin, campaign, canView: false, canManage: false }

    const ownsCampaign = campaign.brand_id === access.brandId || campaign.created_by_brand_id === access.brandId
    if (ownsCampaign) return { admin, campaign, canView: true, canManage: true }

    const { data: coBrand } = await admin
      .from('campaign_brands')
      .select('campaign_id')
      .eq('campaign_id', campaignId)
      .eq('brand_id', access.brandId)
      .maybeSingle()

    return { admin, campaign, canView: !!coBrand, canManage: false }
  }

  const { data: influencer } = await admin
    .from('influencers')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle()

  if (influencer) {
    const { data: membership } = await admin
      .from('campaign_influencers')
      .select('id')
      .eq('campaign_id', campaignId)
      .eq('influencer_id', influencer.id)
      .eq('application_status', 'accepted')
      .maybeSingle()

    return { admin, campaign, canView: !!membership, canManage: false }
  }

  return { admin, campaign, canView: false, canManage: false }
}
