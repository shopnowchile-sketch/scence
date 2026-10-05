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
    location_details,
    venue_name,
    commune,
    city,
    region,
    country,
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

  const requestedLocationId = typeof location_id === 'string' ? location_id : null
  const legacyLocation = typeof location === 'string' ? location : null
  const isVirtual = is_virtual === true

  let canonicalLocationId: string | null = null
  let canonicalLocation: string | null = null

  if (!isVirtual) {
    let inheritedLocationId: string | null = null
    if (campaign_id && !requestedLocationId) {
      const { data: campaign } = await admin.from('campaigns').select('location_id').eq('id', campaign_id).maybeSingle()
      inheritedLocationId = campaign?.location_id ?? null
    }

    try {
      const resolvedLocation = await resolvePhysicalLocation(admin, {
        locationId: requestedLocationId ?? inheritedLocationId,
        venueName: typeof venue_name === 'string' ? venue_name : (typeof location_details?.venue_name === 'string' ? location_details.venue_name : null),
        address: legacyLocation,
        commune: typeof commune === 'string' ? commune : (typeof location_details?.commune === 'string' ? location_details.commune : null),
        city: typeof city === 'string' ? city : null,
        region: typeof region === 'string' ? region : (typeof location_details?.region === 'string' ? location_details.region : null),
        country: typeof country === 'string' ? country : (typeof location_details?.country === 'string' ? location_details.country : null),
        organizationId: orgId,
      })
      if (resolvedLocation.matchType === 'ambiguous') return NextResponse.json({ error: 'La ubicación coincide con más de un lugar. Selecciona una Location existente.' }, { status: 409 })
      if (resolvedLocation.matchType === 'insufficient_data' && (requestedLocationId || inheritedLocationId || legacyLocation?.trim())) {
        return NextResponse.json({ error: 'Faltan datos suficientes para identificar la ubicación física.' }, { status: 422 })
      }
      canonicalLocationId = resolvedLocation.locationId
      if (canonicalLocationId) {
        const { data: canonical } = await admin.from('locations').select('name, address').eq('id', canonicalLocationId).single()
        canonicalLocation = canonical?.address ?? canonical?.name ?? null
      }
    } catch (error) {
      if (error instanceof PhysicalLocationError) return NextResponse.json({ error: error.message }, { status: error.status })
      throw error
    }
  }

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
