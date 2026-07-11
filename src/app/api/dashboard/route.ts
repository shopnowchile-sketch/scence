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
    influencersCountRes,
    influencersEnteredCountRes,
    brandsCountRes,
    brandsEnteredCountRes,
    invoicesMonthRes,
    payrollMonthRes,
    pendingDeliverablesRes,
    recentActivityRes,
    pendingApplicationsRes,
  ] = await Promise.all([
    // Solo el CONTEO de campañas activas (no se descargan las filas).
    db.from('campaigns')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .not('status', 'in', '("canceled","completed")'),

    // Conteo exacto real (sin cap de fila) — usado para el KPI "Influencers en roster"
    db.from('influencers')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId),

    // Conteo exacto de influencers que tienen cuenta de acceso.
    // No descarga las filas completas del roster.
    db.from('influencers')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .not('user_id', 'is', null),

    // Conteos de marcas sin descargar su listado completo.
    db.from('brands')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId),

    db.from('brands')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .not('user_id', 'is', null),

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

  // Totales mediante COUNT, sin descargar las aproximadamente 1.700 filas.
  const totalInfluencers = influencersCountRes.count ?? 0
  const influencersEntered = influencersEnteredCountRes.count ?? 0
  const totalBrands = brandsCountRes.count ?? 0
  const brandsEntered = brandsEnteredCountRes.count ?? 0

  // Consultar solamente perfiles vistos durante los últimos 10 minutos.
  const tenMinAgoIso = new Date(Date.now() - 10 * 60 * 1000).toISOString()

  const liveProfilesRes = await db.from('profiles')
    .select('id, last_seen_at')
    .gte('last_seen_at', tenMinAgoIso)
    .order('last_seen_at', { ascending: false })
    .limit(500)

  const liveProfileIds = (liveProfilesRes.data ?? [])
    .map(profile => profile.id)
    .filter((id): id is string => Boolean(id))

  let liveInfluencers: Array<{
    id: string
    name: string | null
    last_seen_at: string | null
  }> = []

  if (liveProfileIds.length > 0) {
    const liveInfluencersRes = await db.from('influencers')
      .select('id, user_id, display_name')
      .eq('organization_id', orgId)
      .in('user_id', liveProfileIds)

    const lastSeenMap = Object.fromEntries(
      (liveProfilesRes.data ?? []).map(profile => [
        profile.id as string,
        profile.last_seen_at as string | null,
      ])
    )

    liveInfluencers = (liveInfluencersRes.data ?? [])
      .map(influencer => ({
        id: influencer.id,
        name: influencer.display_name,
        last_seen_at: influencer.user_id
          ? lastSeenMap[influencer.user_id] ?? null
          : null,
      }))
      .filter(influencer => influencer.last_seen_at !== null)
      .sort(
        (a, b) =>
          new Date(b.last_seen_at as string).getTime() -
          new Date(a.last_seen_at as string).getTime()
      )
      .slice(0, 10)
  }

  return NextResponse.json({
    kpis: {
      active_campaigns:  campaignsRes.count ?? 0,
      total_influencers: totalInfluencers,
      total_brands:      totalBrands,
      brands_entered:    brandsEntered,
      brands_pending:    Math.max(0, totalBrands - brandsEntered),
      revenue_month:     revenueThisMonth,
      payroll_month:     payrollThisMonth,
      margin,
      margin_pct:        marginPct,
    },
    influencer_portal: {
      entered: influencersEntered,
      pending: Math.max(0, totalInfluencers - influencersEntered),
    },
    live_influencers: liveInfluencers,
    pending_deliverables: pendingDeliverablesRes.data ?? [],
    pending_applications_count: pendingApplicationsRes.count ?? 0,
    recent_activity:      recentActivityRes.data ?? [],
    revenue_chart:        revenueChart,
  })
}
