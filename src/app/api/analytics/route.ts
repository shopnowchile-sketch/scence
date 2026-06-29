import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'
import { startOfMonth, endOfMonth, subMonths, format } from 'date-fns'

export async function GET(request: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  const { searchParams } = new URL(request.url)
  const range = searchParams.get('range') ?? '6m' // 1m, 3m, 6m, 12m

  const monthsBack = range === '12m' ? 12 : range === '3m' ? 3 : range === '1m' ? 1 : 6
  const now = new Date()

  // Build month ranges
  const months = Array.from({ length: monthsBack }, (_, i) => {
    const d = subMonths(now, monthsBack - 1 - i)
    return {
      start: format(startOfMonth(d), 'yyyy-MM-dd'),
      end:   format(endOfMonth(d), 'yyyy-MM-dd'),
      label: format(d, 'MMM'),
    }
  })

  const [
    campaignStats,
    influencerStats,
    deliverableStats,
    topInfluencers,
    platformBreakdown,
  ] = await Promise.all([
    // Campaign stats
    admin.from('campaigns')
      .select('id, name, status, type, budget_total, budget_spent, platforms, start_date, end_date')
      .eq('organization_id', orgId ?? 'none')
      .order('created_at', { ascending: false })
      .limit(20),

    // Influencer stats — top by campaigns (scoped by org via campaign join)
    admin.from('campaign_influencers')
      .select(`
        influencer_id, fee, status,
        influencer:influencers (id, display_name, avatar_url, city,
          influencer_social_profiles (platform, followers, engagement_rate, is_primary)),
        campaign:campaigns!inner (organization_id)
      `)
      .eq('campaign.organization_id', orgId ?? 'none')
      .limit(100),

    // Deliverable stats (scoped by org via campaign join)
    admin.from('campaign_deliverables')
      .select('id, status, type, platform, campaign_id, campaign:campaigns!inner(organization_id)')
      .eq('campaign.organization_id', orgId ?? 'none')
      .not('campaign_id', 'is', null),

    // Top performing influencers by total fees (scoped by org via campaign join)
    admin.from('campaign_influencers')
      .select(`
        influencer_id, fee,
        influencer:influencers (id, display_name, avatar_url,
          influencer_social_profiles (platform, followers, engagement_rate, is_primary)),
        campaign:campaigns!inner (organization_id)
      `)
      .eq('campaign.organization_id', orgId ?? 'none')
      .not('fee', 'is', null)
      .order('fee', { ascending: false })
      .limit(10),

    // Revenue by month
    Promise.all(months.map(async m => {
      const [rev, pay, cmp] = await Promise.all([
        admin.from('invoices').select('total')
          .eq('organization_id', orgId ?? 'none').in('status', ['paid', 'sent'])
          .gte('issue_date', m.start).lte('issue_date', m.end),
        admin.from('payroll_runs').select('total_amount')
          .eq('organization_id', orgId ?? 'none').in('status', ['approved', 'processing', 'paid'])
          .gte('created_at', m.start).lte('created_at', m.end + 'T23:59:59Z'),
        admin.from('campaigns').select('id')
          .eq('organization_id', orgId ?? 'none').eq('status', 'active')
          .lte('start_date', m.end).or(`end_date.gte.${m.start},end_date.is.null`),
      ])
      return {
        month:     m.label,
        revenue:   (rev.data ?? []).reduce((s, r) => s + (r.total ?? 0), 0),
        payroll:   (pay.data ?? []).reduce((s, r) => s + (r.total_amount ?? 0), 0),
        campaigns: cmp.data?.length ?? 0,
      }
    })),
  ])

  // Deliverable completion rates
  const allDeliverables = deliverableStats.data ?? []
  const byStatus = {
    pending:   allDeliverables.filter(d => d.status === 'pending').length,
    in_review: allDeliverables.filter(d => d.status === 'in_review').length,
    approved:  allDeliverables.filter(d => d.status === 'approved').length,
    rejected:  allDeliverables.filter(d => d.status === 'rejected').length,
    published: allDeliverables.filter(d => d.status === 'published').length,
  }

  // Platform distribution from deliverables
  const byPlatform = allDeliverables.reduce<Record<string, number>>((acc, d) => {
    if (d.platform) acc[d.platform] = (acc[d.platform] ?? 0) + 1
    return acc
  }, {})

  // Campaign type distribution
  const campaigns = campaignStats.data ?? []
  const byType = campaigns.reduce<Record<string, number>>((acc, c) => {
    acc[c.type] = (acc[c.type] ?? 0) + 1
    return acc
  }, {})

  // Top influencers aggregated fees
  type InfRow = { id: string; display_name: string; avatar_url: string | null; social_profiles: Array<{ platform: string; followers: number; followers_count?: number; engagement_rate: number; is_primary: boolean }> }
  const influencerFees = (topInfluencers.data ?? []).reduce<Record<string, { name: string; avatar: string | null; total: number; engagement: number; followers: number }>>((acc, ci) => {
    const inf = (ci.influencer as unknown as InfRow | InfRow[])
    const infObj = Array.isArray(inf) ? inf[0] : inf
    if (!infObj) return acc
    const primary = infObj.social_profiles?.find(sp => sp.is_primary) ?? infObj.social_profiles?.[0]
    if (!acc[infObj.id]) {
      acc[infObj.id] = {
        name:       infObj.display_name,
        avatar:     infObj.avatar_url,
        total:      0,
        engagement: primary?.engagement_rate ?? 0,
        followers:  primary?.followers_count ?? primary?.followers ?? 0,
      }
    }
    acc[infObj.id].total += (ci.fee as number | null) ?? 0
    return acc
  }, {})

  return NextResponse.json({
    revenue_trend:  platformBreakdown,
    campaign_stats: {
      total:     campaigns.length,
      active:    campaigns.filter(c => c.status === 'active').length,
      completed: campaigns.filter(c => c.status === 'completed').length,
      total_budget: campaigns.reduce((s, c) => s + (c.budget_total ?? 0), 0),
      total_spent:  campaigns.reduce((s, c) => s + (c.budget_spent ?? 0), 0),
      by_type: byType,
    },
    deliverable_stats: {
      total: allDeliverables.length,
      completion_rate: allDeliverables.length > 0
        ? Math.round((byStatus.published / allDeliverables.length) * 100)
        : 0,
      by_status:   byStatus,
      by_platform: byPlatform,
    },
    top_influencers: Object.values(influencerFees)
      .sort((a, b) => b.total - a.total)
      .slice(0, 8),
  })
}
