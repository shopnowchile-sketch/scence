import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'

type Params = { params: { id: string; locationId: string } }
type BrandRecord = { id: string; user_id: string | null }

const LOCATION_TYPES = ['store', 'online', 'event', 'restaurant', 'home', 'virtual', 'other'] as const

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

async function getManagedBrand(userId: string, brandId: string, admin: ReturnType<typeof createAdminClient>) {
  const { data: brand } = await admin
    .from('brands')
    .select('id, user_id')
    .eq('id', brandId)
    .maybeSingle()

  return brand && await canManageBrand(userId, brand, admin) ? brand : null
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  if (!(await getManagedBrand(user.id, params.id, admin))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })

  const update: Record<string, string | boolean | null> = {}
  if (typeof body.name === 'string') {
    const name = body.name.trim()
    if (!name) return NextResponse.json({ error: 'Nombre requerido' }, { status: 422 })
    update.name = name
  }
  for (const key of ['address', 'city', 'region', 'country', 'notes'] as const) {
    if (body[key] !== undefined) {
      update[key] = typeof body[key] === 'string' && body[key].trim() ? body[key].trim() : null
    }
  }
  if (body.location_type !== undefined) {
    if (typeof body.location_type !== 'string' || !(LOCATION_TYPES as readonly string[]).includes(body.location_type)) {
      return NextResponse.json({ error: 'Tipo de lugar inválido' }, { status: 422 })
    }
    update.location_type = body.location_type
    update.is_sensitive = body.location_type === 'home'
    if (body.location_type === 'home') update.is_public = false
  }
  const websiteUrl = normalizeWebsiteUrl(body.website_url)
  if (websiteUrl === undefined) return NextResponse.json({ error: 'Ingresa un link válido de e-commerce' }, { status: 422 })
  if (websiteUrl !== undefined) update.website_url = websiteUrl

  if (body.is_public !== undefined && update.location_type !== 'home') {
    update.is_public = body.is_public === true
  }
  if (Object.keys(update).length === 0) return NextResponse.json({ error: 'Sin cambios válidos' }, { status: 422 })

  const { data, error } = await admin
    .from('brand_locations')
    .update(update)
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
  if (!(await getManagedBrand(user.id, params.id, admin))) {
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
