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
  if (q) {
    const needle = normalizePhysicalText(q)
    rows = rows.filter(row =>
      normalizePhysicalText(row.name).includes(needle) ||
      normalizePhysicalText(row.address).includes(needle)
    )
  }

  return NextResponse.json({ data: rows })
}
