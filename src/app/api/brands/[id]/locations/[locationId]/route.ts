import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId, getUserRole, hasBrandPermission, resolveBrandAccess } from '@/lib/supabase/ensureOrg'

type Params = { params: { id: string; locationId: string } }

async function canEditBrand(user: { id: string; user_metadata?: Record<string, unknown> }, brandId: string, admin: ReturnType<typeof createAdminClient>) {
  const brandAccess = await resolveBrandAccess(user.id)
  if (brandAccess) {
    return brandAccess.brandId === brandId && hasBrandPermission(brandAccess, 'location.manage')
  }

  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return false
  return (await getUserRole(user.id, orgId, admin)).isAdmin
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  if (!(await canEditBrand(user, params.id, admin))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const allowed = {
    name: body.name,
    address: body.address,
    city: body.city,
    region: body.region,
    country: body.country,
    location_type: body.location_type,
    is_sensitive: body.location_type === 'home' ? true : body.is_sensitive,
    is_public: body.location_type === 'home' ? false : body.is_public,
    notes: body.notes,
  }

  Object.keys(allowed).forEach(k => {
    if ((allowed as any)[k] === undefined) delete (allowed as any)[k]
  })

  const { data, error } = await admin
    .from('brand_locations')
    .update(allowed)
    .eq('id', params.locationId)
    .eq('brand_id', params.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  if (!(await canEditBrand(user, params.id, admin))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { error } = await admin
    .from('brand_locations')
    .delete()
    .eq('id', params.locationId)
    .eq('brand_id', params.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
