import { NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { getOrgId, isPlatformAdmin } from '@/lib/supabase/ensureOrg'

/** Admin de plataforma (organization_members). Mismo criterio que /api/tickets. */
export async function requireSupportAdmin() {
  const supabase = createServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const
  const admin = createAdminClient()
  if (!(await isPlatformAdmin(user.id, admin))) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) } as const
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return { error: NextResponse.json({ error: 'Organization not found' }, { status: 400 }) } as const
  return { admin, orgId, userId: user.id } as const
}
