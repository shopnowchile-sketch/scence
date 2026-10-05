import { NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { isPlatformAdmin } from '@/lib/supabase/ensureOrg'
import { normalizePhysicalText } from '@/lib/resolvePhysicalLocation'

type Row = {
  id: string
  parent_id: string | null
  level: string
  name: string
  address: string | null
  type: string | null
  brand_id: string | null
  is_private: boolean
  is_active: boolean
}

function geoContext(row: Row, byId: Map<string, Row>) {
  let country = ''
  let region = ''
  let city = ''
  let commune = ''
  const seen = new Set<string>()
  let current: Row | undefined = row
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    if (current.level === 'country') country = current.name
    if (current.level === 'region') region = current.name
    if (current.level === 'city') city = current.name
    if (current.level === 'commune') commune = current.name
    current = current.parent_id ? byId.get(current.parent_id) : undefined
  }
  return { country, region, city, commune }
}

export async function GET() {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  if (!(await isPlatformAdmin(user.id, admin))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const [{ data: locations, error: locationError }, { data: campaigns, error: campaignError }, { data: bookings, error: bookingError }, { data: events, error: eventError }, { data: campaignBrands, error: campaignBrandsError }] = await Promise.all([
    admin.from('locations').select('id, parent_id, level, name, address, type, brand_id, is_private, is_active'),
    admin.from('campaigns').select('id, brand_id, location_id, address, metadata'),
    admin.from('bookings').select('id, campaign_id, location_id, location, location_details'),
    admin.from('events').select('id, campaign_id, location_id, location'),
    admin.from('campaign_brands').select('campaign_id, brand_id'),
  ])

  const firstError = locationError || campaignError || bookingError || eventError || campaignBrandsError
  if (firstError) return NextResponse.json({ error: firstError.message }, { status: 500 })

  const rows = (locations ?? []) as Row[]
  const byId = new Map(rows.map(row => [row.id, row]))
  const physical = rows.filter(row => row.level === 'place' && row.is_active && !row.is_private && row.type !== 'influencer_home')

  const campaignsRows = campaigns ?? []
  const bookingsRows = bookings ?? []
  const eventsRows = events ?? []

  const campaignHintsWithoutLocation = campaignsRows.filter(row => {
    const metadata = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? row.metadata as Record<string, unknown> : {}
    const address = typeof row.address === 'string' && row.address.trim() ? row.address : metadata.address
    const venue = typeof metadata.venue_name === 'string' ? metadata.venue_name : null
    const commune = typeof metadata.commune === 'string' ? metadata.commune : null
    return !row.location_id && Boolean(String(address ?? '').trim() || String(venue ?? '').trim() || String(commune ?? '').trim())
  }).length

  const bookingOrphans = bookingsRows.filter(row => !row.location_id && Boolean(row.location || row.location_details)).length
  const eventOrphans = eventsRows.filter(row => !row.location_id && Boolean(row.location)).length

  const duplicateGroups = new Map<string, number>()
  for (const row of physical) {
    const key = normalizePhysicalText(row.address)
    if (key) duplicateGroups.set(key, (duplicateGroups.get(key) ?? 0) + 1)
  }

  const locationBrandUsage = new Map<string, Set<string>>()
  const addUsage = (locationId: string | null, brandId: string | null) => {
    if (!locationId || !brandId) return
    const set = locationBrandUsage.get(locationId) ?? new Set<string>()
    set.add(brandId)
    locationBrandUsage.set(locationId, set)
  }

  for (const campaign of campaignsRows) addUsage(campaign.location_id, campaign.brand_id)
  for (const link of campaignBrands ?? []) {
    const campaign = campaignsRows.find(row => row.id === link.campaign_id)
    addUsage(campaign?.location_id ?? null, link.brand_id)
  }

  const placesWithoutAddress = physical.filter(row => !row.address?.trim()).length
  const placesWithoutCommune = physical.filter(row => !geoContext(row, byId).commune).length
  const placesWithoutCity = physical.filter(row => !geoContext(row, byId).city).length

  return NextResponse.json({
    data: {
      campaigns_with_location_id: campaignsRows.filter(row => row.location_id).length,
      campaigns_without_location_id: campaignsRows.filter(row => !row.location_id).length,
      campaigns_with_legacy_address: campaignsRows.filter(row => {
        const metadata = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? row.metadata as Record<string, unknown> : {}
        return Boolean(
          (typeof row.address === 'string' && row.address.trim()) ||
          (typeof metadata.address === 'string' && metadata.address.trim())
        )
      }).length,
      physical_locations: physical.length,
      potential_duplicate_location_groups: [...duplicateGroups.values()].filter(count => count > 1).length,
      locations_without_address: placesWithoutAddress,
      locations_without_commune: placesWithoutCommune,
      locations_without_city: placesWithoutCity,
      locations_used_by_multiple_brands: [...locationBrandUsage.values()].filter(brands => brands.size > 1).length,
      campaigns_without_location_but_with_location_hints: campaignHintsWithoutLocation,
      bookings_without_location_but_with_location_data: bookingOrphans,
      events_without_location_but_with_location_data: eventOrphans,
    },
  })
}
