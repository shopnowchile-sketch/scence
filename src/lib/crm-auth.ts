import type { SupabaseClient, User } from '@supabase/supabase-js'
import { isPlatformAdmin } from '@/lib/supabase/ensureOrg'

/** Autoriza el CRM desde la fuente canónica: organization_members. */
export async function isCrmAdmin(
  user: Pick<User, 'id' | 'user_metadata'>,
  admin: SupabaseClient,
): Promise<boolean> {
  return isPlatformAdmin(user.id, admin)
}
