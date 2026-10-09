import { NextRequest, NextResponse } from 'next/server'
import { authorizeBrandLocations } from '@/lib/brand-locations-auth'
import { locationDbError, isUuid } from '@/lib/locations'
import { validateBrandPlacePatch } from '@/lib/brand-places'

type Params = { params: { id: string } }

const PLACE_COLUMNS = 'id, parent_id, level, type, name, address, is_active, is_private, notes'

// Solo se editan lugares propios; cualquier otro id responde 404 (no se revela que existe).
async function ownPlaceId(admin: any, brandId: string, id: string) {
  const { data } = await admin.from('locations').select('id').eq('id', id).eq('level', 'place').eq('brand_id', brandId).maybeSingle()
  return Boolean(data)
}

// PATCH /api/brand/locations/[id] — { name?, address?, type?, notes? }
export async function PATCH(req: NextRequest, { params }: Params) {
  if (!isUuid(params.id)) return NextResponse.json({ error: 'Identificador inválido' }, { status: 400 })
  const auth = await authorizeBrandLocations('location.manage')
  if ('res' in auth) return auth.res
  const { admin, access } = auth

  if (!(await ownPlaceId(admin, access.brandId, params.id))) return NextResponse.json({ error: 'Lugar no encontrado' }, { status: 404 })

  const parsed = validateBrandPlacePatch(await req.json().catch(() => null))
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 })

  const { data, error } = await admin.from('locations').update(parsed.value)
    .eq('id', params.id).eq('brand_id', access.brandId).select(PLACE_COLUMNS).single()
  if (error) {
    const e = locationDbError(error)
    return NextResponse.json({ error: e.error }, { status: e.status })
  }
  return NextResponse.json({ data })
}

// DELETE /api/brand/locations/[id] — desactiva (soft delete, igual que /api/locations).
// Las campañas que ya lo usan siguen mostrándolo; deja de ofrecerse para nuevas.
export async function DELETE(_req: NextRequest, { params }: Params) {
  if (!isUuid(params.id)) return NextResponse.json({ error: 'Identificador inválido' }, { status: 400 })
  const auth = await authorizeBrandLocations('location.manage')
  if ('res' in auth) return auth.res
  const { admin, access } = auth

  if (!(await ownPlaceId(admin, access.brandId, params.id))) return NextResponse.json({ error: 'Lugar no encontrado' }, { status: 404 })

  const { error } = await admin.from('locations').update({ is_active: false }).eq('id', params.id).eq('brand_id', access.brandId)
  if (error) {
    const e = locationDbError(error)
    return NextResponse.json({ error: e.error }, { status: e.status })
  }
  return NextResponse.json({ ok: true })
}
