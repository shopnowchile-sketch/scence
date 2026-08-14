import { createAdminClient } from '@/lib/supabase/server'
import { getOrgId, getUserRole, hasBrandPermission, resolveBrandAccess } from '@/lib/supabase/ensureOrg'

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
  if (!campaign) return { admin, campaign: null, canView: false, canViewBrief: false, canViewSponsorBrief: false, canManage: false }

  const orgId = await getOrgId(userId, userMetadata, admin)
  const { isAdmin } = orgId ? await getUserRole(userId, orgId, admin) : { isAdmin: false }
  if (isAdmin) return { admin, campaign, canView: true, canViewBrief: true, canViewSponsorBrief: true, canManage: true }

  const access = await resolveBrandAccess(userId)
  if (access) {

    const ownsCampaign = campaign.brand_id === access.brandId || campaign.created_by_brand_id === access.brandId
    if (ownsCampaign) return {
      admin,
      campaign,
      canView: hasBrandPermission(access, 'campaign.read'),
      canViewBrief: hasBrandPermission(access, 'campaign.read'),
      canViewSponsorBrief: hasBrandPermission(access, 'campaign.read'),
      canManage: hasBrandPermission(access, 'campaign.manage'),
    }

    const { data: coBrand } = await admin
      .from('campaign_brands')
      .select('campaign_id')
      .eq('campaign_id', campaignId)
      .eq('brand_id', access.brandId)
      .maybeSingle()

    const canRead = !!coBrand && hasBrandPermission(access, 'campaign.read')
    if (canRead) return { admin, campaign, canView: true, canViewBrief: true, canViewSponsorBrief: true, canManage: false }

    const { data: opportunityCampaign } = await admin
      .from('campaigns')
      .select('metadata')
      .eq('id', campaignId)
      .eq('status', 'active')
      .maybeSingle()
    const metadata = opportunityCampaign?.metadata && typeof opportunityCampaign.metadata === 'object'
      ? opportunityCampaign.metadata as Record<string, unknown>
      : {}
    const opportunity = metadata.collaboration_opportunity && typeof metadata.collaboration_opportunity === 'object'
      ? metadata.collaboration_opportunity as Record<string, unknown>
      : null
    const canViewSponsorBrief = Boolean(opportunity?.enabled) && hasBrandPermission(access, 'campaign.read')
    return { admin, campaign, canView: false, canViewBrief: false, canViewSponsorBrief, canManage: false }
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
    // Briefs and operational files are private until the influencer is
    // accepted. A pending application only receives the limited public DTO
    // from /api/influencer/campaigns/[id].
    const canViewBrief = canView
    return { admin, campaign, canView, canViewBrief, canViewSponsorBrief: false, canManage: false }
  }

  return { admin, campaign, canView: false, canViewBrief: false, canViewSponsorBrief: false, canManage: false }
}
