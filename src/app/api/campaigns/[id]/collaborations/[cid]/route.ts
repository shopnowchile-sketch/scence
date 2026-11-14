import { NextRequest, NextResponse } from 'next/server'
import {
  COLLAB_SELECT,
  COLLAB_STATUSES,
  planBelongsToCampaign,
  COLLAB_STATUS_LABEL,
  COLLAB_TYPES,
  authorizeCollaborationAdmin,
  hydrateCollaborations,
  type CollabStatus,
} from '@/lib/campaign-collaborations'

type Params = { params: { id: string; cid: string } }

// GET — historial del lead (crm_lead_activities, la misma fuente del CRM).
// Las entradas escritas desde esta campaña llevan campaign_id.
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await authorizeCollaborationAdmin(params.id)
  if (!auth.ok) return auth.response
  const { admin } = auth

  const { data: collab, error } = await admin
    .from('campaign_brand_collaborations').select('id, lead_id').eq('id', params.cid).eq('campaign_id', params.id).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!collab) return NextResponse.json({ error: 'Colaboración no encontrada' }, { status: 404 })
  if (!collab.lead_id) return NextResponse.json({ data: [], has_history: false })

  const { data: activities, error: actError } = await admin
    .from('crm_lead_activities')
    .select('id, action_type, description, created_at, created_by, campaign_id')
    .eq('lead_id', collab.lead_id)
    .order('created_at', { ascending: false })
    .limit(200)
  if (actError) return NextResponse.json({ error: actError.message }, { status: 500 })

  const authorIds = Array.from(new Set((activities ?? []).map(a => a.created_by).filter((v): v is string => !!v)))
  const { data: authors } = authorIds.length
    ? await admin.from('profiles').select('id, full_name, display_name').in('id', authorIds)
    : { data: [] }
  const names = new Map((authors ?? []).map(a => [a.id as string, (a.display_name || a.full_name || null) as string | null]))

  return NextResponse.json({
    has_history: true,
    data: (activities ?? []).map(a => ({ ...a, created_by_name: a.created_by ? names.get(a.created_by) ?? null : null })),
  })
}

// PATCH — datos de la colaboración y/o una nota. La nota se guarda en
// crm_lead_activities (mismo historial del CRM) marcada con esta campaña.
export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await authorizeCollaborationAdmin(params.id)
  if (!auth.ok) return auth.response
  const { admin, userId } = auth

  const body = await req.json().catch(() => ({}))
  const update: Record<string, unknown> = {}

  if (body.status !== undefined) {
    if (!COLLAB_STATUSES.includes(body.status)) return NextResponse.json({ error: 'Estado inválido' }, { status: 422 })
    update.status = body.status
  }
  if (body.collaboration_type !== undefined) {
    if (body.collaboration_type !== null && !COLLAB_TYPES.includes(body.collaboration_type)) {
      return NextResponse.json({ error: 'Tipo de colaboración inválido' }, { status: 422 })
    }
    update.collaboration_type = body.collaboration_type
  }
  if (body.plan_id !== undefined) {
    if (body.plan_id !== null && !(typeof body.plan_id === 'string' && await planBelongsToCampaign(admin, params.id, body.plan_id))) {
      return NextResponse.json({ error: 'Plan inválido para esta campaña' }, { status: 422 })
    }
    update.plan_id = body.plan_id
  }
  for (const [key, max] of [['contribution_detail', 500], ['next_step', 300]] as const) {
    if (body[key] === undefined) continue
    if (body[key] !== null && typeof body[key] !== 'string') return NextResponse.json({ error: `${key} inválido` }, { status: 422 })
    const value = typeof body[key] === 'string' ? body[key].trim() : null
    if (value && value.length > max) return NextResponse.json({ error: `${key} supera ${max} caracteres` }, { status: 422 })
    update[key] = value || null
  }
  if (body.quantity !== undefined) {
    const q = body.quantity === null || body.quantity === '' ? null : Number(body.quantity)
    if (q !== null && (!Number.isInteger(q) || q < 0)) return NextResponse.json({ error: 'Cantidad inválida' }, { status: 422 })
    update.quantity = q
  }
  if (body.follow_up_date !== undefined) {
    if (body.follow_up_date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.follow_up_date))) {
      return NextResponse.json({ error: 'Fecha inválida' }, { status: 422 })
    }
    update.follow_up_date = body.follow_up_date
  }
  if (body.owner_id !== undefined) {
    if (body.owner_id !== null) {
      const { data: owner } = await admin.from('organization_members').select('id').eq('user_id', body.owner_id).eq('is_active', true).eq('role', 'super_admin').limit(1)
      if (!owner?.length) return NextResponse.json({ error: 'Responsable inválido' }, { status: 422 })
    }
    update.owner_id = body.owner_id
  }

  const note = typeof body.note === 'string' ? body.note.trim() : ''
  if (body.note !== undefined && !note) return NextResponse.json({ error: 'La nota no puede estar vacía' }, { status: 422 })
  if (!Object.keys(update).length && !note) return NextResponse.json({ error: 'Nada que actualizar' }, { status: 422 })

  const { data: current, error: currentError } = await admin
    .from('campaign_brand_collaborations').select('id, lead_id, status').eq('id', params.cid).eq('campaign_id', params.id).maybeSingle()
  if (currentError) return NextResponse.json({ error: currentError.message }, { status: 500 })
  if (!current) return NextResponse.json({ error: 'Colaboración no encontrada' }, { status: 404 })
  if (note && !current.lead_id) {
    return NextResponse.json({ error: 'Esta marca no tiene ficha CRM: no hay historial donde guardar la nota' }, { status: 422 })
  }

  if (note) {
    const { error } = await admin.from('crm_lead_activities').insert({
      lead_id: current.lead_id, action_type: 'note', description: note, created_by: userId, campaign_id: params.id,
    })
    if (error) return NextResponse.json({ error: 'No se pudo guardar la nota: ' + error.message }, { status: 500 })
  }

  let row
  if (Object.keys(update).length) {
    const { data, error } = await admin
      .from('campaign_brand_collaborations')
      .update({ ...update, updated_at: new Date().toISOString() })
      .eq('id', params.cid).eq('campaign_id', params.id)
      .select(COLLAB_SELECT).single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    row = data

    if (update.status && update.status !== current.status && current.lead_id) {
      const { error: logError } = await admin.from('crm_lead_activities').insert({
        lead_id: current.lead_id, action_type: 'status_changed', created_by: userId, campaign_id: params.id,
        description: `Estado en campaña: ${COLLAB_STATUS_LABEL[update.status as CollabStatus]}`,
      })
      if (logError) console.error('[PATCH collaborations] historial de estado', logError)
    }
  } else {
    const { data, error } = await admin.from('campaign_brand_collaborations').select(COLLAB_SELECT).eq('id', params.cid).single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    row = data
  }

  const [hydrated] = await hydrateCollaborations(admin, [row])
  return NextResponse.json({ data: hydrated })
}

// DELETE — quita la asociación con la campaña. No toca el lead, la marca ni sus notas.
export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await authorizeCollaborationAdmin(params.id)
  if (!auth.ok) return auth.response
  const { error } = await auth.admin
    .from('campaign_brand_collaborations').delete().eq('id', params.cid).eq('campaign_id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
