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
    .select('id, organization_id, brand_id, created_by_brand_id, visibility, status')
    .eq('id', campaignId)
    .maybeSingle()

  if (error) throw error
  if (!campaign) return { admin, campaign: null, canView: false, canViewBrief: false, canManage: false }

  const orgId = await getOrgId(userId, userMetadata, admin)
  const { isAdmin } = orgId ? await getUserRole(userId, orgId, admin) : { isAdmin: false }
  if (isAdmin) return { admin, campaign, canView: true, canViewBrief: true, canManage: true }

  if (userMetadata?.is_brand) {
    const access = await resolveBrandAccess(userId)
    if (!access) return { admin, campaign, canView: false, canViewBrief: false, canManage: false }

    const ownsCampaign = campaign.brand_id === access.brandId || campaign.created_by_brand_id === access.brandId
    if (ownsCampaign) return { admin, campaign, canView: true, canViewBrief: true, canManage: true }

    const { data: coBrand } = await admin
      .from('campaign_brands')
      .select('campaign_id')
      .eq('campaign_id', campaignId)
      .eq('brand_id', access.brandId)
      .maybeSingle()

    return { admin, campaign, canView: !!coBrand, canViewBrief: !!coBrand, canManage: false }
  }

  const { data: influencer } = await admin
    .from('influencers')
    .select('id, organization_id')
    .eq('user_id', userId)
    .maybeSingle()

  if (influencer) {
    const { data: membership } = await admin
      .from('campaign_influencers')
      .select('id, application_status')
      .eq('campaign_id', campaignId)
      .eq('influencer_id', influencer.id)
      .maybeSingle()

    const canView = membership?.application_status === 'accepted'
    // The campaign brief is deliberately available to a candidate in the same
    // organisation before applying. Other campaign files remain private until
    // acceptance.
    const canViewBrief = !!membership || (
      campaign.visibility === 'open' &&
      campaign.status !== 'draft' &&
      campaign.status !== 'pending_approval' &&
      influencer.organization_id === campaign.organization_id
    )
    return { admin, campaign, canView, canViewBrief, canManage: false }
  }

  return { admin, campaign, canView: false, canViewBrief: false, canManage: false }
}
