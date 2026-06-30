import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'

type Params = { params: { id: string } }

function isAdmin(user: any) {
  const role = user?.user_metadata?.role ?? user?.app_metadata?.role
  return ['super_admin', 'agency_manager', 'admin'].includes(role)
}

export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: brand, error: brandError } = await admin
    .from('brands')
    .select('id, user_id')
    .eq('id', params.id)
    .single()

  if (brandError || !brand) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })

  const canSeePrivate = isAdmin(user) || brand.user_id === user.id

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
    .select('id, user_id')
    .eq('id', params.id)
    .single()

  if (brandError || !brand) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })
  if (!isAdmin(user) && brand.user_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null)
  if (!body?.name) return NextResponse.json({ error: 'Nombre requerido' }, { status: 422 })

  const { data, error } = await admin
    .from('brand_locations')
    .insert({
      brand_id: params.id,
      name: body.name,
      address: body.address || null,
      city: body.city || null,
      region: body.region || null,
      country: body.country || 'Chile',
      is_public: !!body.is_public,
      notes: body.notes || null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data }, { status: 201 })
}
