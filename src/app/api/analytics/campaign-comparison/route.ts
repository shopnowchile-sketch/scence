import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'

type Performance = {
  views?: number | null
  likes?: number | null
  comments?: number | null
}

export async function GET(request: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 400 })
  }

  const params = request.nextUrl.searchParams
  let dateFrom = params.get('date_from')
  const dateTo = params.get('date_to')
  const brandId = params.get('brand_id')
  const campaignId = params.get('campaign_id')
  const platform = params.get('platform')
  const range = params.get('range')

  if (!dateFrom && range) {
    const months = range === '12m' ? 12 : range === '6m' ? 6 : range === '3m' ? 3 : 1
    const from = new Date()
    from.setMonth(from.getMonth() - months)
    dateFrom = from.toISOString().slice(0, 10)
  }

  let campaignQuery = admin
    .from('campaigns')
    .select('id, name, status, brand_id, start_date, end_date, currency')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })

  if (brandId) campaignQuery = campaignQuery.eq('brand_id', brandId)
  if (campaignId) campaignQuery = campaignQuery.eq('id', campaignId)
  if (dateFrom) campaignQuery = campaignQuery.gte('created_at', `${dateFrom}T00:00:00.000Z`)
  if (dateTo) campaignQuery = campaignQuery.lte('created_at', `${dateTo}T23:59:59.999Z`)

  const { data: campaigns, error: campaignError } = await campaignQuery
  if (campaignError) {
    return NextResponse.json({ error: campaignError.message }, { status: 500 })
  }

  const campaignIds = (campaigns ?? []).map(campaign => campaign.id)
  if (campaignIds.length === 0) return NextResponse.json({ data: [] })

  let deliverableQuery = admin
    .from('campaign_deliverables')
    .select('campaign_id, platform, performance, engagement_rate, metrics_updated_at')
    .in('campaign_id', campaignIds)

  if (platform) deliverableQuery = deliverableQuery.eq('platform', platform)
  if (dateFrom) deliverableQuery = deliverableQuery.gte('metrics_updated_at', `${dateFrom}T00:00:00.000Z`)
  if (dateTo) deliverableQuery = deliverableQuery.lte('metrics_updated_at', `${dateTo}T23:59:59.999Z`)

  let conversionQuery = admin
    .from('affiliate_conversions')
    .select('campaign_id, sale_amount, commission_amount, currency, status, confirmed_at')
    .eq('organization_id', orgId)
    .eq('status', 'confirmed')
    .in('campaign_id', campaignIds)

  if (dateFrom) conversionQuery = conversionQuery.gte('confirmed_at', `${dateFrom}T00:00:00.000Z`)
  if (dateTo) conversionQuery = conversionQuery.lte('confirmed_at', `${dateTo}T23:59:59.999Z`)

  const [
    { data: deliverables, error: deliverableError },
    { data: conversions, error: conversionError },
  ] = await Promise.all([deliverableQuery, conversionQuery])

  if (deliverableError) {
    return NextResponse.json({ error: deliverableError.message }, { status: 500 })
  }
  if (conversionError) {
    return NextResponse.json({ error: conversionError.message }, { status: 500 })
  }

  const data = (campaigns ?? []).map(campaign => {
    const campaignDeliverables = (deliverables ?? []).filter(row => row.campaign_id === campaign.id)
    const campaignConversions = (conversions ?? []).filter(row => row.campaign_id === campaign.id)

    const content = campaignDeliverables.reduce((totals, row) => {
      const performance = (row.performance ?? {}) as Performance
      totals.views += Number(performance.views ?? 0)
      totals.likes += Number(performance.likes ?? 0)
      totals.comments += Number(performance.comments ?? 0)
      return totals
    }, { views: 0, likes: 0, comments: 0 })

    const interactions = content.likes + content.comments
    const engagementRate = content.views > 0
      ? Number(((interactions / content.views) * 100).toFixed(2))
      : 0

    const sales = campaignConversions.reduce((totals, conversion) => {
      totals.revenue += Number(conversion.sale_amount ?? 0)
      totals.commission += Number(conversion.commission_amount ?? 0)
      return totals
    }, { revenue: 0, commission: 0 })

    return {
      campaign_id: campaign.id,
      campaign_name: campaign.name,
      status: campaign.status,
      currency: campaign.currency ?? 'CLP',
      deliverables_with_metrics: campaignDeliverables.length,
      views: content.views,
      likes: content.likes,
      comments: content.comments,
      interactions,
      engagement_rate: engagementRate,
      confirmed_sales: campaignConversions.length,
      attributed_revenue: sales.revenue,
      generated_commission: sales.commission,
    }
  })

  return NextResponse.json({
    data,
    meta: {
      date_from: dateFrom,
      date_to: dateTo,
      brand_id: brandId,
      campaign_id: campaignId,
      platform,
      engagement_formula: '(likes + comments) / views * 100',
      verified_metrics_only: true,
    },
  })
}
