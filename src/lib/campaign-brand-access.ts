import { createAdminClient } from '@/lib/supabase/server'
import {
  getOrgId,
  getUserRole,
  hasBrandPermission,
  resolveBrandAccess,
  type BrandAccess,
  type BrandPermission,
} from '@/lib/supabase/ensureOrg'

export type CampaignBrandAuthorization = {
  admin: ReturnType<typeof createAdminClient>
  brandAccess: BrandAccess | null
  isPlatformAdmin: boolean
  campaign: { id: string; organization_id: string; brand_id: string | null; created_by_brand_id: string | null }
}

/** Central authorization for Admin/Marca routes that operate on one campaign. */
export async function authorizeCampaignBrandAction(
  userId: string,
  campaignId: string,
  permission: BrandPermission,
): Promise<CampaignBrandAuthorization | null> {
  const admin = createAdminClient()
  const { data: campaign } = await admin
    .from('campaigns')
    .select('id, organization_id, brand_id, created_by_brand_id')
    .eq('id', campaignId)
    .maybeSingle()
  if (!campaign) return null

  const brandAccess = await resolveBrandAccess(userId)
  if (brandAccess) {
    const ownsCampaign = campaign.brand_id === brandAccess.brandId || campaign.created_by_brand_id === brandAccess.brandId
    if (!ownsCampaign || !hasBrandPermission(brandAccess, permission)) return null
    return { admin, brandAccess, isPlatformAdmin: false, campaign }
  }

  const orgId = await getOrgId(userId, undefined, admin)
  const role = orgId ? await getUserRole(userId, orgId, admin) : null
  if (!role?.isAdmin) return null
  return { admin, brandAccess: null, isPlatformAdmin: true, campaign }
}
