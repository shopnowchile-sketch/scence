import { NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'

// GET /api/influencer/bookings — bookings asignados a esta influencer
export async function GET() {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: influencer } = await admin
    .from('influencers')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!influencer) return NextResponse.json({ error: 'Not an influencer' }, { status: 403 })

  // Buscar en booking_influencers (multi-influencer)
  const { data: biRows, error: biErr } = await admin
    .from('booking_influencers')
    .select(`
      id, status,
      booking:bookings (
        id, title, description, status, starts_at, ends_at, location,
        campaign:campaigns (id, name),
        brand:brands!brand_id (id, name, logo_url)
      )
    `)
    .eq('influencer_id', influencer.id)
    .order('created_at', { ascending: false })

  if (biErr) return NextResponse.json({ error: biErr.message }, { status: 500 })

  // También buscar bookings directos (campo legacy influencer_id en bookings)
  const { data: directRows } = await admin
    .from('bookings')
    .select(`
      id, title, description, status, starts_at, ends_at, location,
      campaign:campaigns (id, name),
      brand:brands!brand_id (id, name, logo_url)
    `)
    .eq('influencer_id', influencer.id)
    .order('starts_at', { ascending: false })

  // Merge y dedup por booking id
  const seen = new Set<string>()
  const merged: Record<string, unknown>[] = []

  for (const row of biRows ?? []) {
    const b = row.booking as unknown as Record<string, unknown> | null
    if (!b) continue
    const bid = b.id as string
    if (seen.has(bid)) continue
    seen.add(bid)
    merged.push({ ...b, my_status: row.status })
  }

  for (const b of directRows ?? []) {
    if (seen.has(b.id)) continue
    seen.add(b.id)
    merged.push({ ...b, my_status: b.status })
  }

  // Ordenar por starts_at
  merged.sort((a, b) => {
    const da = new Date((a.starts_at as string) ?? 0).getTime()
    const db = new Date((b.starts_at as string) ?? 0).getTime()
    return da - db
  })

  return NextResponse.json({ data: merged })
}
