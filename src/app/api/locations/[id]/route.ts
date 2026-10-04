import { NextRequest, NextResponse } from 'next/server'
import { authorizeLocationsAdmin } from '@/lib/locations-server'
import { LOCATION_COLUMNS, PLACE_TYPES, isUuid, locationDbError, toCoord, type BreadcrumbItem } from '@/lib/locations'

type Params = { params: { id: string } }


// GET /api/locations/[id] — nodo + breadcrumb (raíz → nodo)
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await authorizeLocationsAdmin()
  if ('res' in auth) return auth.res
  const { admin } = auth
  if (!isUuid(params.id)) return NextResponse.json({ error: 'Ubicación no encontrada' }, { status: 404 })

  const { data, error } = await admin.from('locations').select(LOCATION_COLUMNS).eq('id', params.id).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Ubicación no encontrada' }, { status: 404 })

  const { data: bc, error: bcError } = await admin.rpc('location_breadcrumb', { p_id: params.id })
  if (bcError) return NextResponse.json({ error: bcError.message }, { status: 500 })
  return NextResponse.json({ data, breadcrumb: (bc ?? []) as BreadcrumbItem[] })
}

// PATCH /api/locations/[id] — editar, mover (parent_id) o activar/desactivar (is_active).
// El nivel no se edita. No hay DELETE: el soft delete es is_active=false
// (un DELETE dejaba en NULL bookings/events.location_id sin aviso).
export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await authorizeLocationsAdmin()
  if ('res' in auth) return auth.res
  const { admin } = auth

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  if (!isUuid(params.id)) return NextResponse.json({ error: 'Ubicación no encontrada' }, { status: 404 })
  if (body.name !== undefined && typeof body.name !== 'string') return NextResponse.json({ error: 'Nombre inválido' }, { status: 422 })
  for (const k of ['parent_id', 'brand_id', 'owner_influencer_id'] as const) {
    if (body[k] && !isUuid(body[k])) return NextResponse.json({ error: `${k} inválido` }, { status: 400 })
  }

  const { data: current, error: currentError } = await admin
    .from('locations').select('level').eq('id', params.id).maybeSingle()
  if (currentError) return NextResponse.json({ error: currentError.message }, { status: 500 })
  if (!current) return NextResponse.json({ error: 'Ubicación no encontrada' }, { status: 404 })

  const update: Record<string, unknown> = {}
  if (body.name !== undefined) update.name = body.name.trim()
  if (body.parent_id !== undefined) update.parent_id = body.parent_id || null
  if (body.notes !== undefined) update.notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null
  if (body.is_active !== undefined) update.is_active = !!body.is_active

  // Campos exclusivos de place: se ignoran en niveles geográficos.
  if (current.level === 'place') {
    if (body.type !== undefined) {
      if (!PLACE_TYPES.includes(body.type)) return NextResponse.json({ error: 'Tipo de lugar inválido' }, { status: 422 })
      update.type = body.type
    }
    if (body.address !== undefined) update.address = typeof body.address === 'string' && body.address.trim() ? body.address.trim() : null
    for (const k of ['lat', 'lng'] as const) {
      if (body[k] === undefined) continue
      const v = toCoord(body[k])
      if (v === 'invalid') return NextResponse.json({ error: 'Latitud/longitud deben ser números' }, { status: 422 })
      update[k] = v
    }
    if (body.is_private !== undefined) update.is_private = !!body.is_private
    if (body.brand_id !== undefined) update.brand_id = body.brand_id || null
    if (body.owner_influencer_id !== undefined) update.owner_influencer_id = body.owner_influencer_id || null
  }

  if (!Object.keys(update).length) return NextResponse.json({ error: 'Nada que actualizar' }, { status: 422 })

  const { data, error } = await admin
    .from('locations')
    .update(update)
    .eq('id', params.id)
    .select(LOCATION_COLUMNS)
    .single()

  if (error) {
    const e = locationDbError(error)
    return NextResponse.json({ error: e.error }, { status: e.status })
  }
  return NextResponse.json({ data })
}
