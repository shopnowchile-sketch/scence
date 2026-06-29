import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { BARTER_STATUS_CONFIG, type BarterStatus } from '@/types'

type Params = { params: { id: string } }

const VALID_STATUSES: BarterStatus[] = [
  'pactado', 'pendiente_envio', 'enviado', 'recibido',
  'contenido_pendiente', 'contenido_publicado', 'cerrado', 'con_problema',
]

const SELECT = `
  *,
  influencer:influencers (id, display_name, avatar_url),
  brand:brands (id, name, logo_url),
  responsible:profiles!barters_responsible_id_fkey (id, full_name),
  history:barter_status_history (
    id, barter_id, from_status, to_status, changed_by, note, created_at,
    actor:profiles!barter_status_history_changed_by_fkey (id, full_name)
  )
`

// ── GET /api/campaigns/[id]/barters ───────────────────────────────────────────
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('barters')
    .select(SELECT)
    .eq('campaign_id', params.id)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[GET /api/campaigns/[id]/barters]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Ordenar el historial de cada canje cronológicamente (asc)
  const normalized = (data ?? []).map((b: any) => ({
    ...b,
    history: [...(b.history ?? [])].sort(
      (a: any, z: any) => (a.created_at < z.created_at ? -1 : 1)
    ),
  }))

  return NextResponse.json({ data: normalized })
}

// ── POST /api/campaigns/[id]/barters — crear ──────────────────────────────────
export async function POST(request: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const {
    influencer_id, item, brand_id, campaign_influencer_id,
    description, estimated_value, currency, agreed_date, responsible_id, notes,
  } = body

  if (!influencer_id || !item) {
    return NextResponse.json(
      { error: 'influencer_id e item son obligatorios' },
      { status: 422 }
    )
  }

  const admin = createAdminClient()

  // Heredar organization_id (y brand por defecto) desde la campaña
  const { data: camp, error: campErr } = await admin
    .from('campaigns')
    .select('organization_id, brand_id, name')
    .eq('id', params.id)
    .single()

  if (campErr || !camp) {
    return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })
  }

  const { data, error } = await admin
    .from('barters')
    .insert({
      organization_id:        camp.organization_id,
      campaign_id:            params.id,
      influencer_id,
      brand_id:               (brand_id as string) ?? camp.brand_id ?? null,
      campaign_influencer_id: (campaign_influencer_id as string) ?? null,
      item,
      description:            (description as string) ?? null,
      estimated_value:        estimated_value != null ? Number(estimated_value) : null,
      currency:               (currency as string) ?? 'CLP',
      agreed_date:            (agreed_date as string) ?? null,
      responsible_id:         (responsible_id as string) ?? null,
      notes:                  (notes as string) ?? null,
      created_by:             user.id,
      status:                 'pactado',
    })
    .select(SELECT)
    .single()

  if (error) {
    console.error('[POST /api/campaigns/[id]/barters]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Notificar al responsable (si hay y no es quien crea)
  await notifyResponsible(admin, {
    responsibleId: data.responsible_id,
    actorId:       user.id,
    barterId:      data.id,
    campaignId:    params.id,
    title:         'Nuevo canje asignado',
    body:          `${data.item} · ${data.influencer?.display_name ?? 'influencer'} (${camp.name})`,
  })

  return NextResponse.json({ data }, { status: 201 })
}

// ── PATCH /api/campaigns/[id]/barters — avanzar estado / editar ───────────────
export async function PATCH(request: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { barter_id, status, note, evidence_url, patch } = body as {
    barter_id: string
    status?: BarterStatus
    note?: string
    evidence_url?: string
    patch?: Record<string, unknown>  // edición de campos no-status
  }

  if (!barter_id) {
    return NextResponse.json({ error: 'barter_id es obligatorio' }, { status: 422 })
  }

  const admin = createAdminClient()

  // Verificar que el canje pertenece a esta campaña
  const { data: existing, error: exErr } = await admin
    .from('barters')
    .select('id, campaign_id, status, item, responsible_id, influencer_id')
    .eq('id', barter_id)
    .eq('campaign_id', params.id)
    .single()

  if (exErr || !existing) {
    return NextResponse.json({ error: 'Canje no encontrado en esta campaña' }, { status: 404 })
  }

  // ── A) Cambio de estado vía RPC atómico (registra historial con actor + nota) ─
  if (status) {
    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: `Estado inválido: ${status}` }, { status: 422 })
    }

    const { error: rpcErr } = await admin.rpc('advance_barter_status', {
      p_barter_id:    barter_id,
      p_status:       status,
      p_actor:        user.id,
      p_note:         note ?? null,
      p_evidence_url: evidence_url ?? null,
    })

    if (rpcErr) {
      console.error('[PATCH barters · rpc]', rpcErr)
      return NextResponse.json({ error: rpcErr.message }, { status: 500 })
    }

    // Notificar al responsable del cambio de estado
    if (existing.status !== status) {
      const isProblem = status === 'con_problema'
      await notifyResponsible(admin, {
        responsibleId: existing.responsible_id,
        actorId:       user.id,
        barterId:      barter_id,
        campaignId:    params.id,
        title:         isProblem ? '⚠️ Canje con problema' : 'Canje actualizado',
        body:          `${existing.item} → ${BARTER_STATUS_CONFIG[status]?.label ?? status}`,
      })
    }
  }

  // ── B) Edición de otros campos (no dispara historial) ─────────────────────────
  if (patch && Object.keys(patch).length > 0) {
    const allowed = ['item', 'description', 'estimated_value', 'currency',
      'agreed_date', 'responsible_id', 'brand_id', 'notes', 'evidence_url']
    const clean: Record<string, unknown> = {}
    for (const k of allowed) if (k in patch) clean[k] = patch[k]
    clean.updated_at = new Date().toISOString()

    const { error: upErr } = await admin.from('barters').update(clean).eq('id', barter_id)
    if (upErr) {
      console.error('[PATCH barters · edit]', upErr)
      return NextResponse.json({ error: upErr.message }, { status: 500 })
    }
  }

  // Devolver el canje completo actualizado
  const { data, error } = await admin
    .from('barters')
    .select(SELECT)
    .eq('id', barter_id)
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const normalized = {
    ...data,
    history: [...((data as any).history ?? [])].sort(
      (a: any, z: any) => (a.created_at < z.created_at ? -1 : 1)
    ),
  }

  return NextResponse.json({ data: normalized })
}

// ── DELETE /api/campaigns/[id]/barters?barter_id=... ──────────────────────────
export async function DELETE(request: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const barterId = request.nextUrl.searchParams.get('barter_id')
  if (!barterId) {
    return NextResponse.json({ error: 'barter_id es obligatorio' }, { status: 422 })
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('barters')
    .delete()
    .eq('id', barterId)
    .eq('campaign_id', params.id)

  if (error) {
    console.error('[DELETE /api/campaigns/[id]/barters]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

// ── Helper: notificación in-app al responsable ────────────────────────────────
async function notifyResponsible(
  admin: ReturnType<typeof createAdminClient>,
  opts: {
    responsibleId: string | null
    actorId: string
    barterId: string
    campaignId: string
    title: string
    body: string
  }
) {
  const { responsibleId, actorId } = opts
  if (!responsibleId || responsibleId === actorId) return
  try {
    await admin.from('notifications').insert({
      recipient_id: responsibleId,
      type:         'campaign_update',
      title:        opts.title,
      body:         opts.body,
      action_url:   `/admin-campaigns/${opts.campaignId}?tab=canjes`,
      entity_type:  'barter',
      entity_id:    opts.barterId,
      is_read:      false,
    })
  } catch (e) {
    // Non-fatal: no romper el flujo si falla la notificación
    console.error('[notifyResponsible]', e)
  }
}
