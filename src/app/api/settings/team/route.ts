import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'
import { isOrgAdmin } from '@/lib/influencers/authz'

// GET /api/settings/team — list org members with profiles
export async function GET() {
  const supabase = createServerClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return NextResponse.json({ error: 'No org' }, { status: 400 })

  const { data, error } = await admin
    .from('organization_members')
    .select('id, user_id, role, is_owner, profile:profiles(display_name, email)')
    .eq('organization_id', orgId)
    .order('is_owner', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data: data ?? [] })
}

// PATCH /api/settings/team — update member role (admin only)
export async function PATCH(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return NextResponse.json({ error: 'No org' }, { status: 400 })

  if (!(await isOrgAdmin(admin, user.id, orgId))) {
    return NextResponse.json({ error: 'Solo administradores pueden cambiar roles' }, { status: 403 })
  }

  const { member_id, role } = await req.json()
  const VALID_ROLES = ['super_admin', 'agency_manager', 'brand_manager', 'finance', 'influencer']
  if (!VALID_ROLES.includes(role)) return NextResponse.json({ error: 'Rol inválido' }, { status: 422 })

  const { error } = await admin
    .from('organization_members')
    .update({ role })
    .eq('id', member_id)
    .eq('organization_id', orgId)
    .eq('is_owner', false)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
