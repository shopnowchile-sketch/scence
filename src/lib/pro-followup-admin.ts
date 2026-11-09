import { NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { getOrgId, getUserRole } from '@/lib/supabase/ensureOrg'

/** Solo admin de plataforma (organization_members vía getUserRole). */
export async function requireAdmin() {
  const supabase = createServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const
  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  const { isAdmin } = orgId ? await getUserRole(user.id, orgId, admin) : { isAdmin: false }
  if (!orgId || !isAdmin) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) } as const
  return { admin, orgId, userId: user.id } as const
}
