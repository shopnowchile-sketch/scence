import { NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { getOrgId, getUserRole } from '@/lib/supabase/ensureOrg'

export async function GET() {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return NextResponse.json({ role: null, isAdmin: false, pendingCampaigns: 0, pendingBrands: 0, openTickets: 0, bookings: 0 })

  const access = await getUserRole(user.id, orgId, admin)

  let pendingQuery = admin
    .from('campaigns')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending_approval')

  if (!access.isAdmin) pendingQuery = pendingQuery.eq('organization_id', orgId)

  let brandsQuery = admin
    .from('brands')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending_approval')

  let ticketsQuery = admin
    .from('tickets')
    .select('id', { count: 'exact', head: true })
    .in('status', ['open', 'in_progress'])

  if (!access.isAdmin) {
    brandsQuery = brandsQuery.eq('organization_id', orgId)
    ticketsQuery = ticketsQuery.eq('organization_id', orgId)
  }

  const [pendingResult, brandsResult, ticketsResult, bookingsResult] = await Promise.all([
    pendingQuery,
    brandsQuery,
    ticketsQuery,
    admin.from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('status', 'proposed'),
  ])

  return NextResponse.json({
    role: access.role,
    isAdmin: access.isAdmin,
    pendingCampaigns: pendingResult.count ?? 0,
    pendingBrands: brandsResult.count ?? 0,
    openTickets: ticketsResult.count ?? 0,
    bookings: bookingsResult.count ?? 0,
  })
}
