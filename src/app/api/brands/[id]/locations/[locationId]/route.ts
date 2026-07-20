import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'

type Params = { params: { id: string; locationId: string } }

async function canManageBrand(user: any, brand: any, admin: any) {
  const role = user?.user_metadata?.role ?? user?.app_metadata?.role
  if (['super_admin', 'admin'].includes(role)) return true
  if (brand.user_id === user.id) return true

  const { data } = await admin
    .from('organization_members')
    .select('role, is_owner')
    .eq('user_id', user.id)
    .eq('organization_id', brand.organization_id ?? 'none')
    .eq('is_active', true)

  return (data ?? []).some((m: any) =>
    m.is_owner || ['super_admin', 'brand_manager'].includes(m.role)
  )
}

async function canEditBrand(user: any, brandId: string, admin: any) {
  const { data: brand } = await admin
    .from('brands')
    .select('id, user_id, organization_id')
    .eq('id', brandId)
    .single()

  return !!brand && await canManageBrand(user, brand, admin)
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
