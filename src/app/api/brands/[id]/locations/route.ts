import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId, getUserRole, resolveBrandAccess } from '@/lib/supabase/ensureOrg'

type Params = { params: { id: string } }

async function canManageBrand(user: any, brand: any, admin: any) {
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  const role = orgId ? await getUserRole(user.id, orgId, admin) : null
  if (role?.isAdmin) return true
  const brandAccess = await resolveBrandAccess(user.id)
  return brandAccess?.brandId === brand.id
}

export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: brand, error: brandError } = await admin
    .from('brands')
    .select('id, user_id, organization_id')
    .eq('id', params.id)
    .single()

  if (brandError || !brand) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })

  const canSeePrivate = await canManageBrand(user, brand, admin)

  let query = admin
    .from('brand_locations')
    .select('*')
    .eq('brand_id', params.id)
    .order('created_at', { ascending: false })

  if (!canSeePrivate) query = query.eq('is_public', true)

  const { data, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data: data ?? [] })
}

export async function POST(req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: brand, error: brandError } = await admin
    .from('brands')
    .select('id, user_id, organization_id')
    .eq('id', params.id)
    .single()

  if (brandError || !brand) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })
  if (!(await canManageBrand(user, brand, admin))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  if (!body?.name) return NextResponse.json({ error: 'Nombre requerido' }, { status: 422 })

  const locationType = typeof body.location_type === 'string' ? body.location_type : 'store'
  const validTypes = ['store', 'event', 'restaurant', 'home', 'virtual', 'other']
  if (!validTypes.includes(locationType)) {
    return NextResponse.json({ error: 'Tipo de lugar inválido' }, { status: 422 })
  }

  const { data, error } = await admin
    .from('brand_locations')
    .insert({
      brand_id: params.id,
      name: body.name,
      address: body.address || null,
      city: body.city || null,
      region: body.region || null,
      country: body.country || 'Chile',
      location_type: locationType,
      is_sensitive: locationType === 'home',
      is_public: locationType === 'home' ? false : !!body.is_public,
      notes: body.notes || null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data }, { status: 201 })
}
