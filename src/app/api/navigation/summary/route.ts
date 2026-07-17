import { NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { getOrgId, getUserRole } from '@/lib/supabase/ensureOrg'

export async function GET() {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return NextResponse.json({ role: null, isAdmin: false, pendingCampaigns: 0, bookings: 0 })

  const access = await getUserRole(user.id, orgId, admin)

  let pendingQuery = admin
    .from('campaigns')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending_approval')

  if (!access.isAdmin) pendingQuery = pendingQuery.eq('organization_id', orgId)

  const [pendingResult, bookingsResult] = await Promise.all([
    pendingQuery,
    admin.from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId),
  ])

  return NextResponse.json({
    role: access.role,
    isAdmin: access.isAdmin,
    pendingCampaigns: pendingResult.count ?? 0,
    bookings: bookingsResult.count ?? 0,
  })
}
