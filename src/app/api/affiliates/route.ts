import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'

function generateCode(): string {
  return Math.random().toString(36).substring(2, 10)
}

// ── GET /api/affiliates ───────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return NextResponse.json({ error: 'Organization not found' }, { status: 400 })

  const { searchParams } = new URL(request.url)
  const influencerId = searchParams.get('influencer_id')
  const campaignId   = searchParams.get('campaign_id')

  let query = admin
    .from('affiliate_links')
    .select(`
      *,
      influencer:influencers (id, display_name),
      campaign:campaigns (id, name)
    `)
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })

  if (influencerId) query = query.eq('influencer_id', influencerId)
  if (campaignId)   query = query.eq('campaign_id', campaignId)

  const { data, error } = await query

  if (error) {
    console.error('[GET /api/affiliates]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data: data ?? [] })
}

// ── POST /api/affiliates ──────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return NextResponse.json({ error: 'Organization not found' }, { status: 400 })

  let body: Record<string, unknown>
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { influencer_id, campaign_id, redirect_url, name, commission_rate } = body as Record<string, string | undefined>

  if (!influencer_id) return NextResponse.json({ error: 'influencer_id is required' }, { status: 422 })
  if (!redirect_url)  return NextResponse.json({ error: 'redirect_url is required' }, { status: 422 })

  // Generate a unique code — retry up to 5 times on collision
  let code = ''
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateCode()
    const { data: existing } = await admin
      .from('affiliate_links')
      .select('id')
      .eq('code', candidate)
      .maybeSingle()
    if (!existing) { code = candidate; break }
  }
  if (!code) return NextResponse.json({ error: 'Could not generate unique code, please retry' }, { status: 500 })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const fullLink = `${appUrl}/track/${code}`

  const { data, error } = await admin
    .from('affiliate_links')
    .insert({
      organization_id: orgId,
      influencer_id,
      campaign_id: campaign_id ?? null,
      name: name ?? null,
      code,
      redirect_url,
      full_link: fullLink,
      clicks: 0,
      conversions: 0,
      revenue: 0,
      commission_rate: commission_rate ? Number(commission_rate) : 0,
      currency: 'CLP',
      is_active: true,
    })
    .select(`
      *,
      influencer:influencers (id, display_name),
      campaign:campaigns (id, name)
    `)
    .single()

  if (error) {
    console.error('[POST /api/affiliates]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data }, { status: 201 })
}
