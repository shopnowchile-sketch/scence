import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'

type Params = { params: { id: string; locationId: string } }

function isAdmin(user: any) {
  const role = user?.user_metadata?.role ?? user?.app_metadata?.role
  return ['super_admin', 'agency_manager', 'admin'].includes(role)
}

async function canEditBrand(user: any, brandId: string, admin: any) {
  const { data: brand } = await admin
    .from('brands')
    .select('id, user_id')
    .eq('id', brandId)
    .single()

  return !!brand && (isAdmin(user) || brand.user_id === user.id)
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
    is_public: body.is_public,
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
