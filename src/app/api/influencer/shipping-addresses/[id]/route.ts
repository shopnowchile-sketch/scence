import { NextRequest, NextResponse } from 'next/server'
import { authorizeInfluencerShipping, setPrimaryShipping, isUuid, SHIPPING_COLUMNS } from '@/lib/influencer-shipping'

type Params = { params: { id: string } }

async function ownAddress(admin: Awaited<ReturnType<typeof authorizeInfluencerShipping>> extends infer A ? A extends { admin: infer C } ? C : never : never, influencerId: string, id: string) {
  if (!isUuid(id)) return null
  const { data } = await admin.from('locations').select('id, is_primary')
    .eq('id', id).eq('type', 'influencer_home').eq('owner_influencer_id', influencerId).maybeSingle()
  return data
}

// PATCH: corregir (name, address, parent_id), marcar principal o reactivar.
// Editar la fila corrige el dato en origen; los envíos ya despachados guardan su location_id.
export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await authorizeInfluencerShipping()
  if ('res' in auth) return auth.res
  const own = await ownAddress(auth.admin, auth.influencerId, params.id)
  if (!own) return NextResponse.json({ error: 'Dirección no encontrada' }, { status: 404 })
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const update: Record<string, unknown> = {}
  if (typeof body.name === 'string' && body.name.trim()) update.name = body.name.trim().slice(0, 120)
  if (typeof body.address === 'string' && body.address.trim()) update.address = body.address.trim().slice(0, 300)
  if (body.parent_id !== undefined) {
    if (!isUuid(body.parent_id)) return NextResponse.json({ error: 'Comuna inválida' }, { status: 422 })
    update.parent_id = body.parent_id
  }
  if (typeof body.is_active === 'boolean') update.is_active = body.is_active
  if (update.is_active === false) update.is_primary = false

  if (Object.keys(update).length) {
    const { error } = await auth.admin.from('locations').update(update).eq('id', params.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 422 })
  }
  if (body.is_primary === true && update.is_active !== false) {
    const e = await setPrimaryShipping(auth.admin, auth.influencerId, params.id)
    if (e) return NextResponse.json({ error: e.message }, { status: 500 })
  }
  const { data } = await auth.admin.from('locations').select(SHIPPING_COLUMNS).eq('id', params.id).single()
  return NextResponse.json({ data })
}

// DELETE = desactivar (nunca borra: un envío puede referenciarla).
export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await authorizeInfluencerShipping()
  if ('res' in auth) return auth.res
  const own = await ownAddress(auth.admin, auth.influencerId, params.id)
  if (!own) return NextResponse.json({ error: 'Dirección no encontrada' }, { status: 404 })
  const { error } = await auth.admin.from('locations').update({ is_active: false, is_primary: false }).eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
