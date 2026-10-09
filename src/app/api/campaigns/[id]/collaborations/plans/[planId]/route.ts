import { NextRequest, NextResponse } from 'next/server'
import { authorizeCollaborationAdmin } from '@/lib/campaign-collaborations'

type Params = { params: { id: string; planId: string } }

// PATCH — edita nombre, monto o descripción de un plan de la campaña.
export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await authorizeCollaborationAdmin(params.id)
  if (!auth.ok) return auth.response
  const { admin } = auth

  const body = await req.json().catch(() => ({}))
  const update: Record<string, unknown> = {}
  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name || name.length > 40) return NextResponse.json({ error: 'El nombre del plan es obligatorio (máx. 40 caracteres)' }, { status: 422 })
    update.name = name
  }
  if (body.amount !== undefined) {
    const amount = body.amount === null || body.amount === '' ? null : Number(body.amount)
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) return NextResponse.json({ error: 'Monto inválido' }, { status: 422 })
    update.amount = amount
  }
  if (body.description !== undefined) {
    const description = typeof body.description === 'string' && body.description.trim() ? body.description.trim() : null
    if (description && description.length > 300) return NextResponse.json({ error: 'La descripción supera 300 caracteres' }, { status: 422 })
    update.description = description
  }
  if (!Object.keys(update).length) return NextResponse.json({ error: 'Nada que actualizar' }, { status: 422 })

  const { data, error } = await admin.from('campaign_collaboration_plans')
    .update({ ...update, updated_at: new Date().toISOString() })
    .eq('id', params.planId).eq('campaign_id', params.id)
    .select('id, campaign_id, name, amount, description, sort_order').maybeSingle()
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'Ya existe un plan con ese nombre en esta campaña' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Plan no encontrado' }, { status: 404 })
  return NextResponse.json({ data })
}

// DELETE — quita el plan; las marcas que lo tenían quedan "sin plan" (no se borran).
export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await authorizeCollaborationAdmin(params.id)
  if (!auth.ok) return auth.response
  const { error } = await auth.admin.from('campaign_collaboration_plans').delete().eq('id', params.planId).eq('campaign_id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
