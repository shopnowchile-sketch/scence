import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'
import { PhysicalLocationError, resolvePhysicalLocation } from '@/lib/resolvePhysicalLocation'

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
      campaigns (id, name, status, location_id),
      location:locations (id, name, address, level, type, is_private, is_active)
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

  // Strip server-managed fields and resolve the physical Location exactly once.
  const { id: _id, created_at: _ca, organization_id: _oi, location, location_id, location_details, venue_name, ...fields } = body

  if (Object.prototype.hasOwnProperty.call(body, 'location_id') || location !== undefined) {
    const requestedLocationId = typeof location_id === 'string' ? location_id : null
    const isVirtual = body.is_virtual === true
    if (isVirtual) {
      fields.location_id = null
      fields.location = null
    } else {
      try {
        const current = await admin.from('events').select('campaign_id, location_id, organization_id').eq('id', params.id).eq('organization_id', orgId).maybeSingle()
        const inherited = !requestedLocationId && current.data?.campaign_id
          ? (await admin.from('campaigns').select('location_id').eq('id', current.data.campaign_id).maybeSingle()).data?.location_id ?? null
          : null
        const resolved = await resolvePhysicalLocation(admin, {
          locationId: requestedLocationId ?? (location === undefined ? inherited : null),
          venueName: typeof venue_name === 'string' ? venue_name : (typeof location_details?.venue_name === 'string' ? location_details.venue_name : null),
          address: typeof location === 'string' ? location : null,
          commune: typeof location_details?.commune === 'string' ? location_details.commune : null,
          region: typeof location_details?.region === 'string' ? location_details.region : null,
          country: typeof location_details?.country === 'string' ? location_details.country : null,
          organizationId: orgId,
        })
        if (resolved.matchType === 'ambiguous') return NextResponse.json({ error: 'La ubicación coincide con más de un lugar. Selecciona una Location existente.' }, { status: 409 })
        if (resolved.matchType === 'insufficient_data' && (requestedLocationId || inherited || (typeof location === 'string' && location.trim()))) {
          return NextResponse.json({ error: 'Faltan datos suficientes para identificar la ubicación física.' }, { status: 422 })
        }
        fields.location_id = resolved.locationId
        if (resolved.locationId) {
          const { data: canonical } = await admin.from('locations').select('name, address').eq('id', resolved.locationId).single()
          fields.location = canonical?.address ?? canonical?.name ?? null
        }
      } catch (error) {
        if (error instanceof PhysicalLocationError) return NextResponse.json({ error: error.message }, { status: error.status })
        throw error
      }
    }
  }

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
