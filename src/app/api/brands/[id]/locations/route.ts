import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'

type Params = { params: { id: string } }
type BrandRecord = { id: string; user_id: string | null; organization_id: string | null }

const LOCATION_TYPES = ['store', 'online', 'event', 'restaurant', 'home', 'virtual', 'other'] as const
type LocationType = typeof LOCATION_TYPES[number]

function normalizeWebsiteUrl(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !value.trim()) return null

  try {
    const candidate = /^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`
    const parsed = new URL(candidate)
    if (!['http:', 'https:'].includes(parsed.protocol)) return undefined
    return parsed.toString()
  } catch {
    return undefined
  }
}

/**
 * Autorización server-side. No usa JWT metadata ni datos del cliente:
 * - owner directo de la marca
 * - brand_manager activo de la marca
 * - administrador global activo en organization_members
 */
async function canManageBrand(userId: string, brand: BrandRecord, admin: ReturnType<typeof createAdminClient>) {
  if (brand.user_id === userId) return true

  const [{ data: brandMember }, { data: staffMemberships }] = await Promise.all([
    admin
      .from('brand_members')
      .select('role')
      .eq('brand_id', brand.id)
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle(),
    admin
      .from('organization_members')
      .select('role')
      .eq('user_id', userId)
      .eq('is_active', true)
      .in('role', ['super_admin', 'admin']),
  ])

  return brandMember?.role === 'brand_manager' || (staffMemberships?.length ?? 0) > 0
}

function validLocationType(value: unknown): value is LocationType {
  return typeof value === 'string' && (LOCATION_TYPES as readonly string[]).includes(value)
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

  const canSeePrivate = await canManageBrand(user.id, brand, admin)
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
  if (!(await canManageBrand(user.id, brand, admin))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'Nombre requerido' }, { status: 422 })

  const locationType = body?.location_type ?? 'store'
  if (!validLocationType(locationType)) {
    return NextResponse.json({ error: 'Tipo de lugar inválido' }, { status: 422 })
  }

  const websiteUrl = normalizeWebsiteUrl(body?.website_url)
  if (websiteUrl === undefined) {
    return NextResponse.json({ error: 'Ingresa un link válido de e-commerce' }, { status: 422 })
  }
  if (locationType === 'online' && !websiteUrl) {
    return NextResponse.json({ error: 'El e-commerce requiere un link' }, { status: 422 })
  }

  const { data, error } = await admin
    .from('brand_locations')
    .insert({
      brand_id: params.id,
      name,
      address: typeof body.address === 'string' && body.address.trim() ? body.address.trim() : null,
      city: typeof body.city === 'string' && body.city.trim() ? body.city.trim() : null,
      region: typeof body.region === 'string' && body.region.trim() ? body.region.trim() : null,
      country: typeof body.country === 'string' && body.country.trim() ? body.country.trim() : 'Chile',
      location_type: locationType,
      website_url: websiteUrl ?? null,
      is_sensitive: locationType === 'home',
      is_public: locationType === 'home' ? false : body?.is_public === true,
      notes: typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data }, { status: 201 })
}
