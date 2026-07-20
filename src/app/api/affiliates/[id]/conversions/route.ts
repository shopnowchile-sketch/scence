import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'

type Params = { params: { id: string } }
const STATUSES = new Set(['pending', 'confirmed', 'cancelled'])
const SOURCES = new Set(['scence', 'webhook', 'coupon', 'csv', 'manual'])

export async function GET(_request: NextRequest, { params }: Params) {
  const access = await getAccess(params.id)
  if ('response' in access) return access.response

  const { data, error } = await access.admin
    .from('affiliate_conversions')
    .select('*')
    .eq('organization_id', access.orgId)
    .eq('affiliate_link_id', params.id)
    .order('occurred_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data: data ?? [] })
}

export async function POST(request: NextRequest, { params }: Params) {
  const access = await getAccess(params.id)
  if ('response' in access) return access.response

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const amount = Number(body.sale_amount)
  const rate = body.commission_rate == null
    ? Number(access.link.commission_rate)
    : Number(body.commission_rate)
  const status = String(body.status ?? 'pending')
  const source = String(body.source ?? 'manual')

  if (!Number.isFinite(amount) || amount < 0) {
    return NextResponse.json({ error: 'sale_amount inválido' }, { status: 422 })
  }
  if (!Number.isFinite(rate) || rate <= 0 || rate > 100) {
    return NextResponse.json({ error: 'commission_rate debe estar entre 0 y 100' }, { status: 422 })
  }
  if (!STATUSES.has(status) || !SOURCES.has(source)) {
    return NextResponse.json({ error: 'Estado o fuente inválida' }, { status: 422 })
  }

  const now = new Date().toISOString()
  const { data, error } = await access.admin
    .from('affiliate_conversions')
    .insert({
      organization_id: access.orgId,
      affiliate_link_id: params.id,
      influencer_id: access.link.influencer_id,
      campaign_id: access.link.campaign_id,
      source,
      external_sale_id: typeof body.external_sale_id === 'string'
        ? body.external_sale_id.trim() || null
        : null,
      sale_amount: amount,
      currency: typeof body.currency === 'string' ? body.currency : access.link.currency ?? 'CLP',
      commission_rate: rate,
      status,
      occurred_at: typeof body.occurred_at === 'string' ? body.occurred_at : now,
      confirmed_at: status === 'confirmed' ? now : null,
      cancelled_at: status === 'cancelled' ? now : null,
      metadata: typeof body.metadata === 'object' && body.metadata ? body.metadata : {},
      created_by: access.userId,
    })
    .select('*')
    .single()

  if (error) {
    const statusCode = error.code === '23505' ? 409 : 500
    return NextResponse.json({ error: error.message }, { status: statusCode })
  }

  return NextResponse.json({ data }, { status: 201 })
}

async function getAccess(affiliateLinkId: string) {
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

  const { data: link } = await admin
    .from('affiliate_links')
    .select('id, organization_id, influencer_id, campaign_id, commission_rate, currency')
    .eq('id', affiliateLinkId)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (!link) {
    return { response: NextResponse.json({ error: 'Affiliate link not found' }, { status: 404 }) }
  }

  return { admin, orgId, userId: user.id, link }
}
