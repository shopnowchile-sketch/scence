import { NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId, getUserRole } from '@/lib/supabase/ensureOrg'
import { resolveLastSeen } from '@/lib/supabase/lastSeen'
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

  // Este dashboard agrega datos globales de operación. Las marcas usan su
  // propio dashboard y nunca deben poder consultar esta vista por API.
  const { isAdmin } = await getUserRole(user.id, orgId, db)
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const monthStart = format(startOfMonth(now), 'yyyy-MM-dd')
  const monthEnd   = format(endOfMonth(now), 'yyyy-MM-dd')
  const chartStart = format(startOfMonth(subMonths(now, 5)), 'yyyy-MM-dd')

  const [
    campaignsRes,
    influencersCountRes,
    influencersWithAccountRes,
    brandsCountRes,
    brandsEnteredCountRes,
    invoicesMonthRes,
    payrollMonthRes,
    pendingDeliverablesRes,
    recentActivityRes,
    pendingApplicationsRes,
    pendingCampaignsRes,
    pendingBrandsRes,
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

    // FIX (2026-07-13, pedido Pri): esto antes era un head-count de
    // "user_id IS NOT NULL" y se mostraba como "Han ingresado" — pero eso
    // mide "tiene cuenta creada", no "entró alguna vez al portal". Ahora se
    // traen los user_id (liviano, solo esa columna) para resolver cuántos
    // tienen una conexión real vía resolveLastSeen (profiles.last_seen_at
    // primero, auth.users.last_sign_in_at como respaldo) más abajo.
    db.from('influencers')
      .select('user_id')
      .eq('organization_id', orgId)
      .not('user_id', 'is', null),

    // Conteos de marcas sin descargar su listado completo.
    // NOTA: a diferencia de influencers (todos bajo la org de la agencia),
    // cada marca-cliente es su propia organización (multi-tenant). Por eso
    // NO se filtra por organization_id aquí — igual que /api/brands
    // (admin-brands), que ya cuenta todas las marcas de la plataforma.
    db.from('brands')
      .select('id', { count: 'exact', head: true }),

    db.from('brands')
      .select('id', { count: 'exact', head: true })
      .not('user_id', 'is', null),

    db.from('invoices')
      .select('total, currency, issue_date')
      .eq('organization_id', orgId)
      .in('status', ['paid', 'sent'])
      .gte('issue_date', chartStart)
      .lte('issue_date', monthEnd),

    db.from('payroll_runs')
      .select('total_amount, currency, created_at')
      .eq('organization_id', orgId)
      .in('status', ['approved', 'processing', 'paid'])
      .gte('created_at', chartStart)
      .lte('created_at', monthEnd + 'T23:59:59Z'),

    db.from('campaign_deliverables')
      .select(`
        id, title, type, status, due_date, platform,
        influencer:influencers (id, display_name, avatar_url),
        campaign:campaigns (id, name)
      `)
      .in('status', ['in_review'])
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
    db.from('campaigns').select('id,name,status,updated_at', { count: 'exact' }).eq('status', 'pending_approval').order('updated_at', { ascending: false }).limit(5),
    db.from('brands').select('id,name,instagram,created_at,status', { count: 'exact' }).eq('status', 'pending_approval').order('created_at', { ascending: false }).limit(5),
  ])

  // Revenue chart — las mismas dos consultas cubren los seis meses. Antes se
  // ejecutaban 12 consultas adicionales (2 por mes).
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = subMonths(now, 5 - i)
    return { key: format(d, 'yyyy-MM'), label: format(d, 'MMM') }
  })

  const revenueByMonth = new Map<string, number>()
  for (const row of invoicesMonthRes.data ?? []) {
    const key = row.issue_date?.slice(0, 7)
    if (key) revenueByMonth.set(key, (revenueByMonth.get(key) ?? 0) + (row.total ?? 0))
  }
  const payrollByMonth = new Map<string, number>()
  for (const row of payrollMonthRes.data ?? []) {
    const key = row.created_at?.slice(0, 7)
    if (key) payrollByMonth.set(key, (payrollByMonth.get(key) ?? 0) + (row.total_amount ?? 0))
  }
  const revenueChart = months.map(m => ({
    month: m.label,
    revenue: revenueByMonth.get(m.key) ?? 0,
    payroll: payrollByMonth.get(m.key) ?? 0,
  }))

  const currentMonthKey = monthStart.slice(0, 7)
  const revenueThisMonth = revenueByMonth.get(currentMonthKey) ?? 0
  const payrollThisMonth = payrollByMonth.get(currentMonthKey) ?? 0
  const margin    = revenueThisMonth - payrollThisMonth
  const marginPct = revenueThisMonth > 0 ? Math.round((margin / revenueThisMonth) * 100) : 0

  // Totales mediante COUNT, sin descargar las aproximadamente 1.700 filas.
  const totalInfluencers = influencersCountRes.count ?? 0
  const totalBrands = brandsCountRes.count ?? 0
  const brandsEntered = brandsEnteredCountRes.count ?? 0

  // "Han ingresado" real (no solo "tiene cuenta") — mismo criterio que la
  // tabla de influencers: profiles.last_seen_at primero, auth.users.last_sign_in_at
  // como respaldo (ver resolveLastSeen). Los que tienen user_id pero ninguna
  // de las dos señales cuentan como "aún no ingresan", junto con los que
  // directamente no tienen cuenta — el widget de arriba es binario
  // (entered/pending) así que ambos casos van al mismo bucket "pending".
  const influencerUserIds = (influencersWithAccountRes.data ?? [])
    .map(row => row.user_id as string | null)
    .filter((id): id is string => Boolean(id))
  // Consultar solamente perfiles vistos durante los últimos 10 minutos.
  const tenMinAgoIso = new Date(Date.now() - 10 * 60 * 1000).toISOString()

  // Ambas operaciones son independientes; ejecutarlas juntas evita sumar sus
  // latencias en organizaciones con muchos usuarios.
  const [influencerLastSeenMap, liveProfilesRes] = await Promise.all([
    resolveLastSeen(db, influencerUserIds),
    db.from('profiles')
      .select('id, last_seen_at')
      .gte('last_seen_at', tenMinAgoIso)
      .order('last_seen_at', { ascending: false })
      .limit(500),
  ])
  const influencersEntered = influencerUserIds.filter(uid => Boolean(influencerLastSeenMap[uid])).length

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
  }

  // Conteo real de conectados (antes de recortar la lista de preview).
  const liveInfluencersCount = liveInfluencers.length
  const liveInfluencersPreview = liveInfluencers.slice(0, 10)

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
    live_influencers: liveInfluencersPreview,
    live_influencers_count: liveInfluencersCount,
    pending_deliverables: pendingDeliverablesRes.data ?? [],
      pending_applications_count: pendingApplicationsRes.count ?? 0,
      pending_deliverables_count: pendingDeliverablesRes.count ?? (pendingDeliverablesRes.data ?? []).length,
      pending_campaigns_count: pendingCampaignsRes.count ?? 0,
      pending_brands_count: pendingBrandsRes.count ?? 0,
      pending_campaigns: pendingCampaignsRes.data ?? [],
      pending_brands: pendingBrandsRes.data ?? [],
    recent_activity:      recentActivityRes.data ?? [],
    revenue_chart:        revenueChart,
  })
}
