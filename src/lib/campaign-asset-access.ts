import { createAdminClient } from '@/lib/supabase/server'
import { getOrgId, getUserRole, hasBrandPermission, resolveBrandAccess } from '@/lib/supabase/ensureOrg'
import { isCampaignBrandCollaborator } from '@/lib/campaign-brand-access'

export async function resolveCampaignAssetAccess(
  userId: string,
  userMetadata: Record<string, unknown>,
  campaignId: string,
) {
  const admin = createAdminClient()
  const { data: campaign, error } = await admin
    .from('campaigns')
    .select('id, organization_id, brand_id, created_by_brand_id, created_by, visibility, status')
    .eq('id', campaignId)
    .maybeSingle()

  if (error) throw error
  if (!campaign) return { admin, campaign: null, canView: false, canViewBrief: false, canViewSponsorBrief: false, canViewBrandGuide: false, canManage: false }

  const orgId = await getOrgId(userId, userMetadata, admin)
  const { isAdmin } = orgId ? await getUserRole(userId, orgId, admin) : { isAdmin: false }
  if (isAdmin) return { admin, campaign, canView: true, canViewBrief: true, canViewSponsorBrief: true, canViewBrandGuide: true, canManage: true }

  const access = await resolveBrandAccess(userId)
  if (access) {

    const ownsCampaign = campaign.brand_id === access.brandId || campaign.created_by_brand_id === access.brandId
    const isCollaborator = await isCampaignBrandCollaborator(admin, campaignId, access.brandId)
    if (ownsCampaign || isCollaborator) {
      const canRead = hasBrandPermission(access, 'campaign.read')
      const canManage = hasBrandPermission(access, 'campaign.manage')
      return {
        admin,
        campaign,
        canView: canRead,
        canViewBrief: canRead,
        canViewSponsorBrief: canRead,
        canViewBrandGuide: canRead,
        canManage,
      }
    }

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
    return { admin, campaign, canView: false, canViewBrief: false, canViewSponsorBrief, canViewBrandGuide: false, canManage: false }
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

    const isSelfCreated = campaign.created_by === userId
    let attendanceConfirmed = false
    if (membership?.application_status === 'accepted' && !isSelfCreated) {
      const { data: attendance } = await admin
        .from('campaign_deliverables')
        .select('attendance_response')
        .eq('campaign_id', campaignId)
        .eq('influencer_id', influencer.id)
        .eq('type', 'event_attendance')
        .maybeSingle()
      // Sin entregable de asistencia no hay confirmación que exigir: rige solo la aceptación.
      attendanceConfirmed = !attendance || attendance.attendance_response === 'confirmed'
    }
    const canView = isSelfCreated || (membership?.application_status === 'accepted' && attendanceConfirmed)
    // Briefs and operational files are private until the influencer confirms
    // attendance. Acceptance alone is not enough: confirmation is the
    // explicit gate into the operational campaign.
    const canViewBrief = canView
    // El MANUAL DE MARCA (asset_type 'brand_guide') es la excepción: la
    // influencer necesita entender la identidad y los lineamientos de la marca
    // ANTES de postular, así que se abre a cualquier influencer sobre una
    // campaña ya publicada — mismo gate de marketplace que usa
    // GET /api/influencer/campaigns/[id]. No abre ningún otro asset.
    const canViewBrandGuide = canView || (campaign.status !== 'draft' && campaign.status !== 'pending_approval')
    return { admin, campaign, canView, canViewBrief, canViewSponsorBrief: false, canViewBrandGuide, canManage: false }
  }

  return { admin, campaign, canView: false, canViewBrief: false, canViewSponsorBrief: false, canViewBrandGuide: false, canManage: false }
}
