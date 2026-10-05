import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'
import { resolvePhysicalLocation, PhysicalLocationError } from '@/lib/resolvePhysicalLocation'

// ── GET /api/events ───────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return NextResponse.json({ error: 'Organization not found' }, { status: 400 })

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')

  let query = admin
    .from('events')
    .select(`
      *,
      event_ticket_types (id, name, price, currency, quantity_total, quantity_sold),
      ticket_sales (id, status)
    `)
    .eq('organization_id', orgId)
    .order('event_date', { ascending: true })

  if (status) query = query.eq('status', status)

  const { data, error } = await query

  if (error) {
    console.error('[GET /api/events]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const enriched = (data ?? []).map(ev => ({
    ...ev,
    ticket_types_count: (ev.event_ticket_types ?? []).length,
    tickets_sold: (ev.event_ticket_types ?? []).reduce(
      (s: number, t: { quantity_sold: number }) => s + (t.quantity_sold ?? 0), 0
    ),
    revenue_total: (ev.ticket_sales ?? [])
      .filter((s: { status: string }) => s.status === 'confirmed')
      .reduce((sum: number, s: { total_amount?: number }) => sum + (s.total_amount ?? 0), 0),
    event_ticket_types: ev.event_ticket_types,
    ticket_sales: undefined,
  }))

  return NextResponse.json({ data: enriched, total: enriched.length })
}

// ── POST /api/events ──────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
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
    name,
    description,
    event_date,
    location,
    location_id,
    is_virtual = false,
    virtual_link,
    capacity,
    campaign_id,
    image_url,
    status = 'draft',
  } = body

  if (!name || typeof name !== 'string' || name.trim() === '') {
    return NextResponse.json({ error: 'name is required' }, { status: 422 })
  }
  if (!event_date) {
    return NextResponse.json({ error: 'event_date is required' }, { status: 422 })
  }

  const locationId = typeof location_id === 'string' ? location_id : null
  const legacyLocation = typeof location === 'string' ? location : null
  const isVirtual = is_virtual === true

  let resolvedLocation
  try {
    resolvedLocation = await resolvePhysicalLocation(admin, {
      locationId,
      location: legacyLocation,
      locationDetails: null,
      isVirtual,
    })
  } catch (error) {
    if (error instanceof PhysicalLocationError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    throw error
  }

  const canonicalLocation = resolvedLocation.locationDisplay
  const canonicalLocationId = resolvedLocation.locationId

  const { data, error } = await admin
    .from('events')
    .insert({
      organization_id: orgId,
      campaign_id: typeof campaign_id === 'string' ? campaign_id : null,
      name: name.trim(),
      description: typeof description === 'string' ? description : null,
      event_date,
      location: canonicalLocation,
      location_id: canonicalLocationId,
      is_virtual: isVirtual,
      virtual_link: typeof virtual_link === 'string' ? virtual_link : null,
      capacity: typeof capacity === 'number' ? capacity : null,
      status: typeof status === 'string' ? status : 'draft',
      image_url: typeof image_url === 'string' ? image_url : null,
    })
    .select()
    .single()

  if (error) {
    console.error('[POST /api/events]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data }, { status: 201 })
}
