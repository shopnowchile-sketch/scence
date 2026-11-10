import { NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { getOrgId, getUserRole } from '@/lib/supabase/ensureOrg'
import { countTicketsAwaitingTeam } from '@/lib/support-tickets'

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
    .select('id, category')
    .in('status', ['open', 'in_progress'])

  // Soporte (tabla de /api/tickets) siempre filtra por la organización del usuario;
  // el contador usa el mismo criterio para que ambos coincidan, también para el admin.
  ticketsQuery = ticketsQuery.eq('organization_id', orgId)
  if (!access.isAdmin) brandsQuery = brandsQuery.eq('organization_id', orgId)

  const [pendingResult, brandsResult, ticketsResult, bookingsResult] = await Promise.all([
    pendingQuery,
    brandsQuery,
    ticketsQuery,
    admin.from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('status', 'proposed'),
  ])

  // Soporte: solo tickets nuevos o con respuesta de la persona que esperan al equipo (no el total de pendientes).
  const activeTickets = (ticketsResult.data ?? []) as Array<{ id: string; category: string | null }>
  const replyRows: Array<{ ticket_id: string; is_admin: boolean | null; created_at: string }> = []
  for (let i = 0; i < activeTickets.length; i += 100) {
    const { data } = await admin.from('ticket_replies').select('ticket_id, is_admin, created_at')
      .in('ticket_id', activeTickets.slice(i, i + 100).map(t => t.id))
    replyRows.push(...((data ?? []) as typeof replyRows))
  }

  return NextResponse.json({
    role: access.role,
    isAdmin: access.isAdmin,
    pendingCampaigns: pendingResult.count ?? 0,
    pendingBrands: brandsResult.count ?? 0,
    openTickets: countTicketsAwaitingTeam(activeTickets, replyRows),
    bookings: bookingsResult.count ?? 0,
  })
}
