import { NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'

// POST /api/influencer/bookings/checkin
// Body: { booking_id: string }
export async function POST(req: Request) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { booking_id } = await req.json()
  if (!booking_id) return NextResponse.json({ error: 'booking_id required' }, { status: 400 })

  const { data: influencer } = await admin
    .from('influencers')
    .select('id')
    .eq('user_id', user.id)
    .single()
  if (!influencer) return NextResponse.json({ error: 'Not an influencer account' }, { status: 403 })

  // Verify this booking belongs to this influencer
  const { data: booking } = await admin
    .from('bookings')
    .select('id, status, starts_at')
    .eq('id', booking_id)
    .eq('influencer_id', influencer.id)
    .single()

  if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })

  const { error: upErr } = await admin
    .from('bookings')
    .update({ status: 'confirmed', checked_in_at: new Date().toISOString() })
    .eq('id', booking_id)

  if (upErr) {
    // Try without checked_in_at in case column doesn't exist
    const { error: upErr2 } = await admin
      .from('bookings')
      .update({ status: 'confirmed' })
      .eq('id', booking_id)
    if (upErr2) return NextResponse.json({ error: upErr2.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
