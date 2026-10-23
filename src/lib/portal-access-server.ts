import { createAdminClient } from '@/lib/supabase/server'
import { isPlatformAdmin, resolveBrandAccess } from '@/lib/supabase/ensureOrg'
import type { PortalAccess } from '@/lib/portal-access'

/** Server-side resolution used by layouts. API routes retain their own
 * resource-level authorization checks (for example resolveBrandAccess()). */
export async function resolvePortalAccess(userId: string): Promise<PortalAccess> {
  const admin = createAdminClient()
  const [platformAdmin, brandResult, influencerResult] = await Promise.all([
    isPlatformAdmin(userId, admin),
    resolveBrandAccess(userId),
    admin.from('influencers').select('id').eq('user_id', userId).limit(1).maybeSingle(),
  ])

  return {
    isPlatformAdmin: platformAdmin,
    brand: brandResult,
    isInfluencer: Boolean(influencerResult.data),
  }
}
