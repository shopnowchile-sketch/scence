import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { getOrgId, hasBrandPermission, isPlatformAdmin, resolveBrandAccess } from '@/lib/supabase/ensureOrg'
import { PhysicalLocationError, resolvePhysicalLocation, type PhysicalLocationInput } from '@/lib/resolvePhysicalLocation'

export async function POST(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const platformAdmin = await isPlatformAdmin(user.id, admin)
  const brand = platformAdmin ? null : await resolveBrandAccess(user.id)

  if (!platformAdmin && (!brand || !hasBrandPermission(brand, 'campaign.manage'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => null) as Partial<PhysicalLocationInput> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const organizationId = platformAdmin ? await getOrgId(user.id, user.user_metadata, admin) : brand?.organizationId ?? null
  if (!organizationId) return NextResponse.json({ error: 'Organization not found' }, { status: 400 })

  try {
    const result = await resolvePhysicalLocation(admin, {
      locationId: body.locationId ?? null,
      venueName: body.venueName ?? null,
      address: body.address ?? null,
      commune: body.commune ?? null,
      city: body.city ?? null,
      region: body.region ?? null,
      country: body.country ?? null,
      organizationId,
    })

    if (result.matchType === 'ambiguous') return NextResponse.json(result, { status: 409 })
    if (result.matchType === 'insufficient_data') return NextResponse.json(result, { status: 422 })

    const { data: location, error } = await admin
      .from('locations')
      .select('id, parent_id, level, type, name, address, is_private, is_active, brand_id')
      .eq('id', result.locationId)
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    if (result.matchType === 'new' && brand?.brandId && !location.brand_id) {
      await admin.from('locations').update({ brand_id: brand.brandId }).eq('id', result.locationId)
      location.brand_id = brand.brandId
    }

    return NextResponse.json({ ...result, location }, { status: result.matchType === 'new' ? 201 : 200 })
  } catch (error) {
    if (error instanceof PhysicalLocationError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('[POST /api/locations/resolve]', error)
    return NextResponse.json({ error: 'No se pudo resolver la Location' }, { status: 500 })
  }
}
