import { NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'

const BRAND_FIELDS = `
  id, name, logo_url, website, instagram, industry, rut,
  contact_name, contact_email, contact_phone,
  address_street, address_number, address_city, address_region, address_country,
  address2_street, address2_number, address2_city, address2_region, address2_country,
  organization_id, user_id
`

async function getAuthenticatedBrandUser() {
  const supabase = createServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { user: null, error: 'Unauthorized' }
  if (!user.user_metadata?.is_brand) return { user: null, error: 'Forbidden' }
  return { user, error: null }
}

// GET /api/brand/me — perfil completo de la marca
export async function GET() {
  const { user, error: authErr } = await getAuthenticatedBrandUser()
  if (!user) return NextResponse.json({ error: authErr }, { status: authErr === 'Unauthorized' ? 401 : 403 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('brands')
    .select(BRAND_FIELDS)
    .eq('user_id', user.id)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })
  return NextResponse.json({ data })
}

// PATCH /api/brand/me — actualizar perfil completo
export async function PATCH(request: Request) {
  const { user, error: authErr } = await getAuthenticatedBrandUser()
  if (!user) return NextResponse.json({ error: authErr }, { status: authErr === 'Unauthorized' ? 401 : 403 })

  const body = await request.json()
  const {
    name, website, instagram, industry, rut,
    contact_name, contact_email, contact_phone,
    address_street, address_number, address_city, address_region, address_country,
    address2_street, address2_number, address2_city, address2_region, address2_country,
  } = body

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('brands')
    .update({
      name,
      website:          website          || null,
      instagram:        instagram        || null,
      industry:         industry         || null,
      rut:              rut              || null,
      contact_name:     contact_name     || null,
      contact_email:    contact_email    || null,
      contact_phone:    contact_phone    || null,
      address_street:   address_street   || null,
      address_number:   address_number   || null,
      address_city:     address_city     || null,
      address_region:   address_region   || null,
      address_country:  address_country  || null,
      address2_street:  address2_street  || null,
      address2_number:  address2_number  || null,
      address2_city:    address2_city    || null,
      address2_region:  address2_region  || null,
      address2_country: address2_country || null,
    })
    .eq('user_id', user.id)
    .select(BRAND_FIELDS)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}
