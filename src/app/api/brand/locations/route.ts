import { NextRequest, NextResponse } from 'next/server'
import { authorizeBrandLocations } from '@/lib/brand-locations-auth'
import { locationDbError, isUuid } from '@/lib/locations'
import { matchesPlaceQuery, normalizeText, validateBrandPlaceCreate } from '@/lib/brand-places'

// Lugares de la MARCA autenticada, sobre public.locations (fuente única).
// Alcance siempre = brand_id de la sesión. Nunca expone lugares de otras marcas,
// domicilios de influencers ni lugares de plataforma sin marca.

const PLACE_COLUMNS = 'id, parent_id, level, type, name, address, is_active, is_private, notes'

// GET /api/brand/locations
//   ?q=texto        → lugares PROPIOS que coinciden (sin tildes), con breadcrumb
//   ?mine=1         → todos los lugares propios activos, con breadcrumb
//   ?parent_id=<id> → hijos GEOGRÁFICOS de ese nodo (país/región/ciudad/comuna); nunca lugares
//   (sin params)    → países
export async function GET(req: NextRequest) {
  const auth = await authorizeBrandLocations('location.read')
  if ('res' in auth) return auth.res
  const { admin, access } = auth

  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q')?.trim() ?? ''

  if (q || searchParams.get('mine') === '1') {
    const { data, error } = await admin
      .from('locations').select(PLACE_COLUMNS)
      .eq('level', 'place').eq('brand_id', access.brandId).eq('is_active', true)
      .order('name')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const places = (data ?? []).filter(p => !q || matchesPlaceQuery(p as { name: string; address: string | null }, q)).slice(0, 50)
    const withBreadcrumb = await Promise.all(places.map(async place => {
      const { data: breadcrumb } = await admin.rpc('location_breadcrumb', { p_id: place.id })
      return { ...place, breadcrumb: breadcrumb ?? [] }
    }))
    return NextResponse.json({ data: withBreadcrumb })
  }

  const parentId = searchParams.get('parent_id') || null
  if (parentId && !isUuid(parentId)) return NextResponse.json({ error: 'Identificador inválido' }, { status: 400 })

  let query = admin.from('locations').select('id, parent_id, level, name').neq('level', 'place').eq('is_active', true)
  query = parentId ? query.eq('parent_id', parentId) : query.is('parent_id', null)
  const { data, error } = await query.order('name')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data: data ?? [] })
}

// POST /api/brand/locations — crea un lugar PROPIO.
// Body: { name, address, parent_id (comuna), type?, notes? }.
// brand_id y organization_id los fija el servidor con la sesión; el body no los controla.
export async function POST(req: NextRequest) {
  const auth = await authorizeBrandLocations('location.manage')
  if ('res' in auth) return auth.res
  const { admin, access, userId } = auth

  const body = await req.json().catch(() => null)
  const parsed = validateBrandPlaceCreate(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 })
  const input = parsed.value

  // Evita duplicados: mismo nombre (sin tildes) en la misma comuna y marca.
  const { data: siblings, error: siblingsError } = await admin
    .from('locations').select('id, name')
    .eq('level', 'place').eq('brand_id', access.brandId).eq('parent_id', input.parent_id).eq('is_active', true)
  if (siblingsError) return NextResponse.json({ error: siblingsError.message }, { status: 500 })
  const existing = (siblings ?? []).find(s => normalizeText(s.name) === normalizeText(input.name))
  if (existing) return NextResponse.json({ error: 'Ya tienes un lugar con ese nombre en esa comuna.', existing_id: existing.id }, { status: 409 })

  const { data, error } = await admin
    .from('locations')
    .insert({
      name: input.name,
      level: 'place',
      parent_id: input.parent_id,
      type: input.type,
      address: input.address,
      notes: input.notes,
      is_private: false,
      brand_id: access.brandId,
      organization_id: access.organizationId,
      created_by: userId,
    })
    .select(PLACE_COLUMNS)
    .single()
  if (error) {
    const e = locationDbError(error)
    return NextResponse.json({ error: e.error }, { status: e.status })
  }
  return NextResponse.json({ data }, { status: 201 })
}
