import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { isPlatformAdmin } from '@/lib/supabase/ensureOrg'

type Params = { params: { id: string } }

// Valores del CHECK de booking_influencers.status (MIGRATIONS_FASE1/V2) y del
// select de admin-bookings/BookingsClient.tsx.
const BOOKING_INFLUENCER_STATUSES = ['invited', 'confirmed', 'declined', 'attended', 'no_show'] as const
type BookingInfluencerStatus = typeof BOOKING_INFLUENCER_STATUSES[number]

export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  if (!(await isPlatformAdmin(user.id, admin))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { status?: unknown }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const status = body.status
  if (typeof status !== 'string' || !BOOKING_INFLUENCER_STATUSES.includes(status as BookingInfluencerStatus)) {
    return NextResponse.json({ error: 'status inválido' }, { status: 400 })
  }

  const { data, error } = await admin
    .from('booking_influencers')
    .update({ status, ...(status === 'confirmed' ? { confirmed_at: new Date().toISOString() } : {}) })
    .eq('id', params.id)
    .select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}
