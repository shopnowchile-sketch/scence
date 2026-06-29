import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'

type Params = { params: { id: string } }

// ── GET /api/events/[id]/sales ────────────────────────────────────────────────
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return NextResponse.json({ error: 'Organization not found' }, { status: 400 })

  const { data, error } = await admin
    .from('ticket_sales')
    .select(`
      *,
      event_ticket_types (id, name, price, currency)
    `)
    .eq('event_id', params.id)
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[GET /api/events/[id]/sales]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data: data ?? [] })
}

// ── POST /api/events/[id]/sales ───────────────────────────────────────────────
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

  const {
    ticket_type_id,
    buyer_name,
    buyer_email,
    buyer_phone,
    quantity = 1,
    payment_method,
    notes,
  } = body as Record<string, unknown>

  if (!ticket_type_id) return NextResponse.json({ error: 'ticket_type_id is required' }, { status: 422 })
  if (!buyer_name)     return NextResponse.json({ error: 'buyer_name is required' }, { status: 422 })
  if (!buyer_email)    return NextResponse.json({ error: 'buyer_email is required' }, { status: 422 })

  // Fetch ticket type to get price and check availability
  const { data: ticketType, error: ttErr } = await admin
    .from('event_ticket_types')
    .select('*')
    .eq('id', ticket_type_id as string)
    .eq('event_id', params.id)
    .single()

  if (ttErr || !ticketType) {
    return NextResponse.json({ error: 'Ticket type not found' }, { status: 404 })
  }

  const qty = Number(quantity)
  const available = ticketType.quantity_total - ticketType.quantity_sold
  if (qty > available) {
    return NextResponse.json({ error: `Only ${available} tickets available` }, { status: 422 })
  }

  const unit_price = ticketType.price
  const total_amount = unit_price * qty

  // Insert sale
  const { data: sale, error: saleErr } = await admin
    .from('ticket_sales')
    .insert({
      event_id: params.id,
      ticket_type_id: ticket_type_id as string,
      organization_id: orgId,
      buyer_name: (buyer_name as string).trim(),
      buyer_email: (buyer_email as string).trim(),
      buyer_phone: buyer_phone ?? null,
      quantity: qty,
      unit_price,
      total_amount,
      currency: ticketType.currency,
      status: 'confirmed',
      payment_method: payment_method ?? null,
      notes: notes ?? null,
    })
    .select()
    .single()

  if (saleErr) {
    console.error('[POST /api/events/[id]/sales]', saleErr)
    return NextResponse.json({ error: saleErr.message }, { status: 500 })
  }

  // Increment quantity_sold on ticket type
  const { error: updateErr } = await admin
    .from('event_ticket_types')
    .update({ quantity_sold: ticketType.quantity_sold + qty })
    .eq('id', ticket_type_id as string)

  if (updateErr) {
    console.error('[POST /api/events/[id]/sales] update quantity_sold', updateErr)
    // Sale already created — log but don't fail the request
  }

  return NextResponse.json({ data: sale }, { status: 201 })
}
