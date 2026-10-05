import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { hasBrandPermission, isPlatformAdmin, resolveBrandAccess } from '@/lib/supabase/ensureOrg'
import { normalizePhysicalText } from '@/lib/resolvePhysicalLocation'

type LocationRow = {
  id: string
  parent_id: string | null
  level: string
  type: string | null
  name: string
  address: string | null
  is_private: boolean
  is_active: boolean
  brand_id: string | null
  brand?: { id: string; name: string } | null
  geography?: string | null
  campaign_count?: number
  booking_count?: number
  event_count?: number
}

export async function GET(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const q = req.nextUrl.searchParams.get('q')?.trim() ?? ''
  const all = await isPlatformAdmin(user.id, admin)

  let locationIds: string[] | null = null

  if (!all) {
    const brand = await resolveBrandAccess(user.id)
    if (!brand || !hasBrandPermission(brand, 'campaign.read')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const [{ data: owned }, { data: collaborators }] = await Promise.all([
      admin.from('campaigns').select('id').or('brand_id.eq.' + brand.brandId + ',created_by_brand_id.eq.' + brand.brandId),
      admin.from('campaign_brands').select('campaign_id').eq('brand_id', brand.brandId),
    ])
    const campaignIds = Array.from(new Set([
      ...(owned ?? []).map(row => row.id),
      ...(collaborators ?? []).map(row => row.campaign_id),
    ]))

    const ids = new Set<string>()
    if (campaignIds.length) {
      const [{ data: campaigns }, { data: bookings }, { data: events }] = await Promise.all([
        admin.from('campaigns').select('location_id').in('id', campaignIds),
        admin.from('bookings').select('location_id').in('campaign_id', campaignIds),
        admin.from('events').select('location_id').in('campaign_id', campaignIds),
      ])
      for (const row of [...(campaigns ?? []), ...(bookings ?? []), ...(events ?? [])]) {
        if (row.location_id) ids.add(row.location_id)
      }
    }

    const { data: brandLocations } = await admin
      .from('locations')
      .select('id')
      .eq('brand_id', brand.brandId)
      .eq('level', 'place')
      .eq('is_active', true)
      .eq('is_private', false)
    for (const row of brandLocations ?? []) ids.add(row.id)

    locationIds = [...ids]
    if (!locationIds.length) return NextResponse.json({ data: [] })
  }

  let query = admin
    .from('locations')
    .select('id, parent_id, level, type, name, address, is_private, is_active, brand_id')
    .eq('level', 'place')
    .eq('is_active', true)
    .eq('is_private', false)

  if (locationIds) query = query.in('id', locationIds)

  const { data, error } = await query.order('name')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let rows = (data ?? []) as LocationRow[]
  const allLocationIds = rows.map(row => row.id)
  const [{ data: geoRows }, { data: campaignRows }, { data: bookingRows }, { data: eventRows }, { data: brandRows }] = await Promise.all([
    admin.from('locations').select('id, parent_id, level, name').eq('is_active', true),
    allLocationIds.length ? admin.from('campaigns').select('id, location_id, brand_id').in('location_id', allLocationIds) : Promise.resolve({ data: [] }),
    allLocationIds.length ? admin.from('bookings').select('id, location_id').in('location_id', allLocationIds) : Promise.resolve({ data: [] }),
    allLocationIds.length ? admin.from('events').select('id, location_id').in('location_id', allLocationIds) : Promise.resolve({ data: [] }),
    allLocationIds.length ? admin.from('brands').select('id, name') : Promise.resolve({ data: [] }),
  ])

  const geoById = new Map((geoRows ?? []).map(row => [row.id, row]))
  const brandById = new Map((brandRows ?? []).map(row => [row.id, row.name]))
  const campaignCount = new Map<string, number>()
  const bookingCount = new Map<string, number>()
  const eventCount = new Map<string, number>()
  for (const row of campaignRows ?? []) if (row.location_id) campaignCount.set(row.location_id, (campaignCount.get(row.location_id) ?? 0) + 1)
  for (const row of bookingRows ?? []) if (row.location_id) bookingCount.set(row.location_id, (bookingCount.get(row.location_id) ?? 0) + 1)
  for (const row of eventRows ?? []) if (row.location_id) eventCount.set(row.location_id, (eventCount.get(row.location_id) ?? 0) + 1)

  function geographyFor(id: string) {
    const names: string[] = []
    const seen = new Set<string>()
    let current = geoById.get(id)
    while (current && current.parent_id && !seen.has(current.id)) {
      seen.add(current.id)
      current = geoById.get(current.parent_id)
      if (current) names.unshift(current.name)
    }
    return names.join(' · ')
  }

  rows = rows.map(row => ({
    ...row,
    brand: row.brand_id ? { id: row.brand_id, name: brandById.get(row.brand_id) ?? 'Sin marca' } : null,
    geography: geographyFor(row.id),
    campaign_count: campaignCount.get(row.id) ?? 0,
    booking_count: bookingCount.get(row.id) ?? 0,
    event_count: eventCount.get(row.id) ?? 0,
  }))

  if (q) {
    const needle = normalizePhysicalText(q)
    rows = rows.filter(row =>
      normalizePhysicalText(row.name).includes(needle) ||
      normalizePhysicalText(row.address).includes(needle) ||
      normalizePhysicalText(row.geography).includes(needle) ||
      normalizePhysicalText(row.brand?.name).includes(needle)
    )
  }

  return NextResponse.json({ data: rows })
}
