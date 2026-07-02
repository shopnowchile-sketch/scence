import { NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'
import { startOfMonth, endOfMonth, subMonths, format } from 'date-fns'

// ── GET /api/dashboard — aggregated KPIs ──────────────────────────────────────
export async function GET() {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db    = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, db)
  const now   = new Date()

  // If still no org (brand new user before first dashboard load), return zeros
  if (!orgId) {
    return NextResponse.json({
      kpis: { active_campaigns: 0, total_influencers: 0, revenue_month: 0, payroll_month: 0, margin: 0, margin_pct: 0 },
      influencer_portal: { entered: 0, pending: 0 },
      live_influencers: [],
      pending_deliverables: [],
      pending_applications_count: 0,
      recent_activity: [],
      revenue_chart: [],
    })
  }

  const monthStart = format(startOfMonth(now), 'yyyy-MM-dd')
  const monthEnd   = format(endOfMonth(now), 'yyyy-MM-dd')

  const [
    campaignsRes,
    influencersRes,
    invoicesMonthRes,
    payrollMonthRes,
    pendingDeliverablesRes,
    recentActivityRes,
    pendingApplicationsRes,
  ] = await Promise.all([
    db.from('campaigns')
      .select('id, status', { count: 'exact', head: false })
      .eq('organization_id', orgId)
      .not('status', 'in', '("canceled","completed")'),

    // FIX (2026-07-02): antes solo se hacía un count(head:true). "Live
    // influencers" y "Acceso al portal de influencers" en el dashboard se
    // calculaban en el cliente a partir de /api/influencers?limit=100 — con
    // 1452 influencers reales eso undercounteaba brutalmente (ej. "35/99"
    // en vez del roster completo). Acá se trae id/user_id/display_name de
    // TODA la org (sin límite, solo 3 columnas) para calcular el real
    // ingreso al portal + quién está online ahora, cruzando con
    // profiles.last_seen_at (mismo dato que ya usa /api/influencers).
    db.from('influencers')
      .select('id, user_id, display_name')
      .eq('organization_id', orgId),

    db.from('invoices')
      .select('total, currency')
      .eq('organization_id', orgId)
      .in('status', ['paid', 'sent'])
      .gte('issue_date', monthStart)
      .lte('issue_date', monthEnd),

    db.from('payroll_runs')
      .select('total_amount, currency')
      .eq('organization_id', orgId)
      .in('status', ['approved', 'processing', 'paid'])
      .gte('created_at', monthStart)
      .lte('created_at', monthEnd + 'T23:59:59Z'),

    db.from('campaign_deliverables')
      .select(`
        id, title, type, status, due_date, platform,
        influencer:influencers (id, display_name, avatar_url),
        campaign:campaigns (id, name)
      `)
      .in('status', ['pending', 'in_review'])
      .order('due_date', { ascending: true })
      .limit(5),

    db.from('campaigns')
      .select('id, name, status, updated_at')
      .eq('organization_id', orgId)
      .order('updated_at', { ascending: false })
      .limit(5),

    // Postulaciones/invitaciones pendientes de gestionar (badge de "Campañas")
    db.from('campaign_influencers')
      .select('id, campaign:campaigns!inner(organization_id)', { count: 'exact', head: true })
      .eq('application_status', 'pending')
      .eq('campaign.organization_id', orgId),
  ])

  // Revenue chart — last 6 months
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = subMonths(now, 5 - i)
    return { start: format(startOfMonth(d), 'yyyy-MM-dd'), end: format(endOfMonth(d), 'yyyy-MM-dd'), label: format(d, 'MMM') }
  })

  const revenueChart = await Promise.all(
    months.map(async m => {
      const [rev, pay] = await Promise.all([
        db.from('invoices').select('total')
          .eq('organization_id', orgId)
          .in('status', ['paid', 'sent'])
          .gte('issue_date', m.start).lte('issue_date', m.end),
        db.from('payroll_runs').select('total_amount')
          .eq('organization_id', orgId)
          .in('status', ['approved', 'processing', 'paid'])
          .gte('created_at', m.start).lte('created_at', m.end + 'T23:59:59Z'),
      ])
      return {
        month:   m.label,
        revenue: (rev.data ?? []).reduce((s, r) => s + (r.total ?? 0), 0),
        payroll: (pay.data ?? []).reduce((s, r) => s + (r.total_amount ?? 0), 0),
      }
    })
  )

  const revenueThisMonth = (invoicesMonthRes.data ?? []).reduce((s, r) => s + (r.total ?? 0), 0)
  const payrollThisMonth = (payrollMonthRes.data ?? []).reduce((s, r) => s + (r.total_amount ?? 0), 0)
  const margin    = revenueThisMonth - payrollThisMonth
  const marginPct = revenueThisMonth > 0 ? Math.round((margin / revenueThisMonth) * 100) : 0

  // Cruce influencers de la org ↔ profiles.last_seen_at (ver comentario arriba)
  const orgInfluencers = influencersRes.data ?? []
  const userIds = orgInfluencers.map(i => i.user_id).filter((id): id is string => Boolean(id))

  let lastSeenMap: Record<string, string | null> = {}
  if (userIds.length > 0) {
    const { data: profs } = await db.from('profiles').select('id, last_seen_at').in('id', userIds)
    lastSeenMap = Object.fromEntries((profs ?? []).map(p => [p.id as string, p.last_seen_at as string | null]))
  }

  const tenMinAgoMs = Date.now() - 10 * 60 * 1000
  const influencersWithSeen = orgInfluencers.map(i => ({
    ...i,
    last_seen_at: i.user_id ? lastSeenMap[i.user_id] ?? null : null,
  }))
  const influencersEntered = influencersWithSeen.filter(i => i.last_seen_at).length
  const liveInfluencers = influencersWithSeen
    .filter(i => i.last_seen_at && new Date(i.last_seen_at).getTime() > tenMinAgoMs)
    .sort((a, b) => new Date(b.last_seen_at as string).getTime() - new Date(a.last_seen_at as string).getTime())
    .slice(0, 10)
    .map(i => ({ id: i.id, name: i.display_name, last_seen_at: i.last_seen_at }))

  return NextResponse.json({
    kpis: {
      active_campaigns:  campaignsRes.data?.length ?? 0,
      total_influencers: orgInfluencers.length,
      revenue_month:     revenueThisMonth,
      payroll_month:     payrollThisMonth,
      margin,
      margin_pct:        marginPct,
    },
    influencer_portal: {
      entered: influencersEntered,
      pending: Math.max(0, orgInfluencers.length - influencersEntered),
    },
    live_influencers: liveInfluencers,
    pending_deliverables: pendingDeliverablesRes.data ?? [],
    pending_applications_count: pendingApplicationsRes.count ?? 0,
    recent_activity:      recentActivityRes.data ?? [],
    revenue_chart:        revenueChart,
  })
}
