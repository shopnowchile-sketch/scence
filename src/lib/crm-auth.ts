import type { SupabaseClient, User } from '@supabase/supabase-js'
import { getOrgId, getUserRole } from '@/lib/supabase/ensureOrg'

/** Autoriza el CRM desde la fuente canónica: organization_members. */
export async function isCrmAdmin(
  user: Pick<User, 'id' | 'user_metadata'>,
  admin: SupabaseClient,
): Promise<boolean> {
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return false

  const access = await getUserRole(user.id, orgId, admin)
  return access.isAdmin
}
