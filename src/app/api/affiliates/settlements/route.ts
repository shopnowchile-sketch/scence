import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'

export async function GET() {
  const access = await getAccess()
  if ('response' in access) return access.response

  const { data, error } = await access.admin
    .from('commission_settlements')
    .select('*, influencer:influencers (id, display_name, avatar_url), campaign:campaigns (id, name), conversions:commission_settlement_conversions (conversion:affiliate_conversions (id, sale_amount, commission_amount, currency, occurred_at, affiliate_link_id, external_sale_id))')
    .eq('organization_id', access.orgId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data: data ?? [] })
}

export async function POST(request: NextRequest) {
  const access = await getAccess()
  if ('response' in access) return access.response

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const conversionIds = Array.isArray(body.conversion_ids)
    ? Array.from(new Set(body.conversion_ids.filter(id => typeof id === 'string'))) as string[]
    : []
  if (conversionIds.length === 0) {
    return NextResponse.json({ error: 'Selecciona conversiones confirmadas' }, { status: 422 })
  }

  const { data: conversions, error: conversionError } = await access.admin
    .from('affiliate_conversions')
    .select('id, influencer_id, campaign_id, commission_amount, currency, occurred_at, status')
    .eq('organization_id', access.orgId)
    .eq('status', 'confirmed')
    .in('id', conversionIds)

  if (conversionError) {
    return NextResponse.json({ error: conversionError.message }, { status: 500 })
  }
  if (!conversions || conversions.length !== conversionIds.length) {
    return NextResponse.json(
      { error: 'Hay conversiones inexistentes, canceladas o todavía pendientes' },
      { status: 422 }
    )
  }

  const influencerIds = new Set(conversions.map(conversion => conversion.influencer_id))
  const currencies = new Set(conversions.map(conversion => conversion.currency))
  if (influencerIds.size !== 1 || currencies.size !== 1) {
    return NextResponse.json(
      { error: 'Una liquidación debe pertenecer a una influencer y una moneda' },
      { status: 422 }
    )
  }

  const amount = conversions.reduce(
    (sum, conversion) => sum + Number(conversion.commission_amount ?? 0), 0
  )
  const occurredDates = conversions.map(conversion => conversion.occurred_at.slice(0, 10)).sort()
  const campaignIds = Array.from(new Set(
    conversions.map(conversion => conversion.campaign_id).filter(Boolean)
  ))

  const { data: settlement, error: settlementError } = await access.admin
    .from('commission_settlements')
    .insert({
      organization_id: access.orgId,
      influencer_id: Array.from(influencerIds)[0],
      campaign_id: campaignIds.length === 1 ? campaignIds[0] : null,
      amount,
      currency: Array.from(currencies)[0],
      period_start: occurredDates[0],
      period_end: occurredDates[occurredDates.length - 1],
      status: 'pending',
      notes: typeof body.notes === 'string' ? body.notes.trim() || null : null,
      created_by: access.userId,
    })
    .select('*')
    .single()

  if (settlementError) {
    return NextResponse.json({ error: settlementError.message }, { status: 500 })
  }

  const { error: linksError } = await access.admin
    .from('commission_settlement_conversions')
    .insert(conversionIds.map(conversionId => ({
      settlement_id: settlement.id,
      conversion_id: conversionId,
    })))

  if (linksError) {
    await access.admin.from('commission_settlements').delete().eq('id', settlement.id)
    const status = linksError.code === '23505' ? 409 : 500
    return NextResponse.json({ error: linksError.message }, { status })
  }

  return NextResponse.json({ data: settlement }, { status: 201 })
}

async function getAccess() {
  const supabase = createServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) {
    return { response: NextResponse.json({ error: 'Organization not found' }, { status: 400 }) }
  }

  return { admin, orgId, userId: user.id }
}
