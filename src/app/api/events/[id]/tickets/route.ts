import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'

type Params = { params: { id: string } }

// ── GET /api/events/[id]/tickets ──────────────────────────────────────────────
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return NextResponse.json({ error: 'Organization not found' }, { status: 400 })

  const { data, error } = await admin
    .from('event_ticket_types')
    .select('*')
    .eq('event_id', params.id)
    .eq('organization_id', orgId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[GET /api/events/[id]/tickets]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data: data ?? [] })
}

// ── POST /api/events/[id]/tickets ─────────────────────────────────────────────
export async function POST(request: NextRequest, { params }: Params) {
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

  const { name, price, currency = 'CLP', quantity_total, description } = body as Record<string, unknown>

  if (!name || typeof name !== 'string' || name.trim() === '') {
    return NextResponse.json({ error: 'name is required' }, { status: 422 })
  }
  if (price === undefined || price === null) {
    return NextResponse.json({ error: 'price is required' }, { status: 422 })
  }
  if (!quantity_total) {
    return NextResponse.json({ error: 'quantity_total is required' }, { status: 422 })
  }

  const { data, error } = await admin
    .from('event_ticket_types')
    .insert({
      event_id: params.id,
      organization_id: orgId,
      name: (name as string).trim(),
      description: description ?? null,
      price: Number(price),
      currency,
      quantity_total: Number(quantity_total),
      quantity_sold: 0,
    })
    .select()
    .single()

  if (error) {
    console.error('[POST /api/events/[id]/tickets]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data }, { status: 201 })
}
