import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'
import { isOrgAdmin } from '@/lib/influencers/authz'

// GET /api/me/role — returns user role + isAdmin flag
export async function GET(_req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return NextResponse.json({ isAdmin: false, role: null }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return NextResponse.json({ isAdmin: false, role: null })

  // Get role from organization_members
  const { data: member } = await admin
    .from('organization_members')
    .select('role, is_owner')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single()

  const role = member?.role ?? 'brand_manager'
  const isAdmin = !!(member?.is_owner || ['super_admin'].includes(role))

  return NextResponse.json({ isAdmin, role, isOwner: member?.is_owner ?? false })
}
