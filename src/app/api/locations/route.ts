import { NextRequest, NextResponse } from 'next/server'
import { authorizeLocationsAdmin } from '@/lib/locations-server'
import { getOrgId } from '@/lib/supabase/ensureOrg'
import {
  LOCATION_COLUMNS, LOCATION_LEVELS, PLACE_TYPES, isUuid, locationDbError, toCoord,
  type BreadcrumbItem, type LocationLevel, type LocationRow,
} from '@/lib/locations'

// Locations — fuente única de ubicación (jerarquía country → region → [city] → commune → place).
// Fase 1: solo admin de plataforma. Contiene domicilios privados de influencers:
// cualquier consumidor futuro no-admin debe filtrar por dueño + is_private.


// GET /api/locations
//   ?q=texto              → búsqueda sin tildes con breadcrumb
//   ?parent_id=<id>       → hijos de ese nodo (sin parent_id → raíz: países y lugares sin ubicar)
//   ?include_inactive=1   → incluye desactivados
export async function GET(req: NextRequest) {
  const auth = await authorizeLocationsAdmin()
  if ('res' in auth) return auth.res
  const { admin } = auth

  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q')?.trim() ?? ''
  const includeInactive = searchParams.get('include_inactive') === '1'

  if (q) {
    const { data, error } = await admin.rpc('search_locations', {
      p_query: q, p_include_inactive: includeInactive, p_limit: 50,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ data: data ?? [] })
  }

  const parentId = searchParams.get('parent_id') || null
  if (parentId && !isUuid(parentId)) return NextResponse.json({ error: 'Identificador inválido' }, { status: 400 })

  let query = admin.from('locations').select(LOCATION_COLUMNS)
  query = parentId ? query.eq('parent_id', parentId) : query.is('parent_id', null)
  if (!includeInactive) query = query.eq('is_active', true)
  const { data: rows, error } = await query.order('name')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const nodes = (rows ?? []) as unknown as LocationRow[]
  const order = (l: LocationLevel) => LOCATION_LEVELS.indexOf(l)
  nodes.sort((a, b) => order(a.level) - order(b.level) || a.name.localeCompare(b.name, 'es'))

  // Conteo de hijos para la navegación (una sola query).
  const ids = nodes.filter(n => n.level !== 'place').map(n => n.id)
  if (ids.length) {
    let childQuery = admin.from('locations').select('parent_id').in('parent_id', ids)
    if (!includeInactive) childQuery = childQuery.eq('is_active', true)
    const { data: children, error: childError } = await childQuery
    if (childError) return NextResponse.json({ error: childError.message }, { status: 500 })
    const counts = new Map<string, number>()
    for (const c of children ?? []) counts.set(c.parent_id as string, (counts.get(c.parent_id as string) ?? 0) + 1)
    for (const n of nodes) n.children_count = counts.get(n.id) ?? 0
  }

  let breadcrumb: BreadcrumbItem[] = []
  if (parentId) {
    const { data: bc, error: bcError } = await admin.rpc('location_breadcrumb', { p_id: parentId })
    if (bcError) return NextResponse.json({ error: bcError.message }, { status: 500 })
    breadcrumb = (bc ?? []) as BreadcrumbItem[]
    if (!breadcrumb.length) return NextResponse.json({ error: 'Ubicación no encontrada' }, { status: 404 })
  }

  return NextResponse.json({ data: nodes, breadcrumb })
}

// POST /api/locations — crear nodo. La base valida la jerarquía.
export async function POST(req: NextRequest) {
  const auth = await authorizeLocationsAdmin()
  if ('res' in auth) return auth.res
  const { user, admin } = auth

  const body = await req.json().catch(() => null)
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const level = body?.level as LocationLevel
  if (!name) return NextResponse.json({ error: 'El nombre es obligatorio' }, { status: 422 })
  if (!LOCATION_LEVELS.includes(level)) return NextResponse.json({ error: 'Nivel inválido' }, { status: 422 })
  for (const k of ['parent_id', 'brand_id', 'owner_influencer_id'] as const) {
    if (body[k] && !isUuid(body[k])) return NextResponse.json({ error: `${k} inválido` }, { status: 400 })
  }

  const base = {
    name,
    level,
    parent_id: body.parent_id || null,
    notes: typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null,
    created_by: user.id,
  }

  let insert: Record<string, unknown> = base
  if (level === 'place') {
    if (!PLACE_TYPES.includes(body.type)) return NextResponse.json({ error: 'Tipo de lugar inválido' }, { status: 422 })
    const lat = toCoord(body.lat), lng = toCoord(body.lng)
    if (lat === 'invalid' || lng === 'invalid') return NextResponse.json({ error: 'Latitud/longitud deben ser números' }, { status: 422 })
    // Dueño de tenant del place: la org de plataforma del admin que lo crea.
    const orgId = await getOrgId(user.id, user.user_metadata, admin)
    if (!orgId) return NextResponse.json({ error: 'Organization not found' }, { status: 400 })
    insert = {
      ...base,
      organization_id:     orgId,
      type:                body.type,
      address:             typeof body.address === 'string' && body.address.trim() ? body.address.trim() : null,
      lat,
      lng,
      is_private:          !!body.is_private,
      brand_id:            body.brand_id || null,
      owner_influencer_id: body.owner_influencer_id || null,
    }
  }

  const { data, error } = await admin.from('locations').insert(insert).select(LOCATION_COLUMNS).single()
  if (error) {
    const e = locationDbError(error)
    return NextResponse.json({ error: e.error }, { status: e.status })
  }
  return NextResponse.json({ data }, { status: 201 })
}
