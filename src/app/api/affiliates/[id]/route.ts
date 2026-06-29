import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'

type Params = { params: { id: string } }

// ── GET /api/affiliates/[id] ──────────────────────────────────────────────────
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return NextResponse.json({ error: 'Organization not found' }, { status: 400 })

  const { data, error } = await admin
    .from('affiliate_links')
    .select(`
      *,
      influencer:influencers (id, display_name),
      campaign:campaigns (id, name),
      clicks_history:affiliate_link_clicks (*)
    `)
    .eq('id', params.id)
    .eq('organization_id', orgId)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return NextResponse.json({ error: 'Not found' }, { status: 404 })
    console.error('[GET /api/affiliates/[id]]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data })
}

// ── PATCH /api/affiliates/[id] ────────────────────────────────────────────────
export async function PATCH(request: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return NextResponse.json({ error: 'Organization not found' }, { status: 400 })

  let body: Record<string, unknown>
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const allowed: Record<string, unknown> = {}
  if ('name'         in body) allowed.name         = body.name
  if ('redirect_url' in body) allowed.redirect_url = body.redirect_url
  if ('conversions'  in body) allowed.conversions  = body.conversions
  if ('revenue'      in body) allowed.revenue      = body.revenue
  allowed.updated_at = new Date().toISOString()

  const { data, error } = await admin
    .from('affiliate_links')
    .update(allowed)
    .eq('id', params.id)
    .eq('organization_id', orgId)
    .select(`
      *,
      influencer:influencers (id, display_name),
      campaign:campaigns (id, name)
    `)
    .single()

  if (error) {
    console.error('[PATCH /api/affiliates/[id]]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data })
}

// ── DELETE /api/affiliates/[id] ───────────────────────────────────────────────
export async function DELETE(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return NextResponse.json({ error: 'Organization not found' }, { status: 400 })

  const { error } = await admin
    .from('affiliate_links')
    .delete()
    .eq('id', params.id)
    .eq('organization_id', orgId)

  if (error) {
    console.error('[DELETE /api/affiliates/[id]]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
