import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'

async function getOwnerBrand() {
  const supabase = createServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user || !user.user_metadata?.is_brand) return { user: null, brand: null }

  const admin = createAdminClient()
  const { data: brand } = await admin
    .from('brands')
    .select('id, organization_id')
    .eq('user_id', user.id)
    .single()

  return { user, brand: brand ?? null }
}

// GET /api/brand/members — lista de usuarios con acceso a la marca
export async function GET() {
  const { user, brand } = await getOwnerBrand()
  if (!user || !brand) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('brand_members')
    .select('id, email, role, invited_at, joined_at, is_active')
    .eq('brand_id', brand.id)
    .order('invited_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data: data ?? [] })
}

// POST /api/brand/members — invitar nuevo usuario
export async function POST(request: NextRequest) {
  const { user, brand } = await getOwnerBrand()
  if (!user || !brand) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { email, role = 'editor' } = await request.json()
  if (!email) return NextResponse.json({ error: 'Email requerido' }, { status: 400 })
  if (!['editor', 'viewer'].includes(role)) return NextResponse.json({ error: 'Rol inválido' }, { status: 400 })

  const admin = createAdminClient()

  // Insertar en brand_members (invitación pendiente)
  const { data, error } = await admin
    .from('brand_members')
    .insert({
      brand_id:   brand.id,
      email,
      role,
      invited_by: user.id,
    })
    .select('id, email, role, invited_at, is_active')
    .single()

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'Este email ya fue invitado' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data }, { status: 201 })
}

// DELETE /api/brand/members?id=... — desactivar miembro
export async function DELETE(request: NextRequest) {
  const { user, brand } = await getOwnerBrand()
  if (!user || !brand) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const memberId = request.nextUrl.searchParams.get('id')
  if (!memberId) return NextResponse.json({ error: 'ID requerido' }, { status: 400 })

  const admin = createAdminClient()
  const { error } = await admin
    .from('brand_members')
    .update({ is_active: false })
    .eq('id', memberId)
    .eq('brand_id', brand.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
