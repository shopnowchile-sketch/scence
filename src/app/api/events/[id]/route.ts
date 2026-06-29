import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'

type Params = { params: { id: string } }

// ── GET /api/events/[id] ──────────────────────────────────────────────────────
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return NextResponse.json({ error: 'Organization not found' }, { status: 400 })

  const { data: event, error: evErr } = await admin
    .from('events')
    .select(`
      *,
      event_ticket_types (
        id, name, description, price, currency, quantity_total, quantity_sold, created_at
      ),
      campaigns (id, name, status)
    `)
    .eq('id', params.id)
    .eq('organization_id', orgId)
    .single()

  if (evErr) {
    if (evErr.code === 'PGRST116') return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    console.error('[GET /api/events/[id]]', evErr)
    return NextResponse.json({ error: evErr.message }, { status: 500 })
  }

  const { data: recentSales, error: salesErr } = await admin
    .from('ticket_sales')
    .select('*')
    .eq('event_id', params.id)
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(20)

  if (salesErr) {
    console.error('[GET /api/events/[id] sales]', salesErr)
  }

  return NextResponse.json({ data: { ...event, recent_sales: recentSales ?? [] } })
}

// ── PATCH /api/events/[id] ────────────────────────────────────────────────────
export async function PATCH(request: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return NextResponse.json({ error: 'Organization not found' }, { status: 400 })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Strip server-managed fields
  const { id: _id, created_at: _ca, organization_id: _oi, ...fields } = body

  const { data, error } = await admin
    .from('events')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .eq('organization_id', orgId)
    .select()
    .single()

  if (error) {
    if (error.code === 'PGRST116') return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    console.error('[PATCH /api/events/[id]]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data })
}

// ── DELETE /api/events/[id] — soft cancel ────────────────────────────────────
export async function DELETE(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return NextResponse.json({ error: 'Organization not found' }, { status: 400 })

  const { error } = await admin
    .from('events')
    .update({ status: 'canceled', updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .eq('organization_id', orgId)

  if (error) {
    console.error('[DELETE /api/events/[id]]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
