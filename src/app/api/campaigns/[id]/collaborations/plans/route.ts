import { NextRequest, NextResponse } from 'next/server'
import { STANDARD_PLAN_NAMES, authorizeCollaborationAdmin } from '@/lib/campaign-collaborations'

type Params = { params: { id: string } }
const PLAN_SELECT = 'id, campaign_id, name, amount, description, sort_order'

// POST /api/campaigns/[id]/collaborations/plans
//   { standard: true }                       → carga Bronze/Gold/Naming (sin montos; solo los que falten)
//   { name, amount?, description? }          → crea un plan de la campaña
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await authorizeCollaborationAdmin(params.id)
  if (!auth.ok) return auth.response
  const { admin } = auth

  const body = await req.json().catch(() => ({}))
  const { data: existing, error: existingError } = await admin
    .from('campaign_collaboration_plans').select('name, sort_order').eq('campaign_id', params.id)
  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 })
  const nextOrder = (existing ?? []).reduce((max, p) => Math.max(max, p.sort_order ?? 0), -1) + 1

  if (body.standard === true) {
    const have = new Set((existing ?? []).map(p => p.name.trim().toLowerCase()))
    const missing = STANDARD_PLAN_NAMES.filter(name => !have.has(name.toLowerCase()))
    if (missing.length) {
      const { error } = await admin.from('campaign_collaboration_plans')
        .insert(missing.map((name, i) => ({ campaign_id: params.id, name, sort_order: nextOrder + i })))
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }
  } else {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name || name.length > 40) return NextResponse.json({ error: 'El nombre del plan es obligatorio (máx. 40 caracteres)' }, { status: 422 })
    const amount = body.amount === undefined || body.amount === null || body.amount === '' ? null : Number(body.amount)
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) return NextResponse.json({ error: 'Monto inválido' }, { status: 422 })
    const description = typeof body.description === 'string' && body.description.trim() ? body.description.trim() : null
    if (description && description.length > 300) return NextResponse.json({ error: 'La descripción supera 300 caracteres' }, { status: 422 })
    const { error } = await admin.from('campaign_collaboration_plans')
      .insert({ campaign_id: params.id, name, amount, description, sort_order: nextOrder })
    if (error) {
      if (error.code === '23505') return NextResponse.json({ error: 'Ya existe un plan con ese nombre en esta campaña' }, { status: 409 })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  const { data, error } = await admin.from('campaign_collaboration_plans').select(PLAN_SELECT)
    .eq('campaign_id', params.id).order('sort_order').order('created_at')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data }, { status: 201 })
}
