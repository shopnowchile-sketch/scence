import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { BARTER_STATUS_CONFIG, type BarterStatus } from '@/types'
import { getOrgId } from '@/lib/supabase/ensureOrg'

type Params = { params: { id: string } }

const VALID_STATUSES: BarterStatus[] = [
  'pactado', 'pendiente_envio', 'enviado', 'recibido',
  'contenido_pendiente', 'contenido_publicado', 'cerrado', 'con_problema',
]

const SELECT = `
  *,
  influencer:influencers (id, display_name, avatar_url, email),
  brand:brands (id, name, logo_url),
  responsible:profiles!barters_responsible_id_fkey (id, full_name),
  benefits:barter_benefits (
    id, organization_id, barter_id, benefit_type, description, fixed_value,
    currency, commission_rate, affiliate_link_id, position, created_at, updated_at
  ),
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
  const campaign = await getAccessibleCampaign(admin, user.id, user.user_metadata, params.id)
  if (!campaign) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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
    campaign_benefits: campaign.campaign_benefits ?? [],
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
    description, estimated_value, currency, agreed_date, responsible_id, notes, benefits,
    initialize_tracking,
  } = body

  if (initialize_tracking !== true && (!influencer_id || !item)) {
    return NextResponse.json(
      { error: 'influencer_id e item son obligatorios' },
      { status: 422 }
    )
  }

  const admin = createAdminClient()

  // Verifica pertenencia a la organización antes de usar el service role.
  const camp = await getAccessibleCampaign(admin, user.id, user.user_metadata, params.id)
  if (!camp) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (initialize_tracking === true) {
    const { data: participants, error: participantsError } = await admin
      .from('campaign_influencers')
      .select('id, influencer_id')
      .eq('campaign_id', params.id)
      .eq('application_status', 'accepted')

    if (participantsError) {
      return NextResponse.json({ error: participantsError.message }, { status: 500 })
    }

    const { data: existing, error: existingError } = await admin
      .from('barters')
      .select('influencer_id')
      .eq('campaign_id', params.id)

    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 })
    }

    const existingIds = new Set((existing ?? []).map(row => row.influencer_id))
    const totalValue = (Array.isArray(camp.campaign_benefits) ? camp.campaign_benefits : [])
      .reduce((sum: number, benefit: any) => sum + (Number(benefit?.estimated_value) || 0), 0)
    const missing = (participants ?? []).filter(row => !existingIds.has(row.influencer_id))

    if (missing.length > 0) {
      const { error: insertError } = await admin.from('barters').insert(missing.map(row => ({
        organization_id: camp.organization_id,
        campaign_id: params.id,
        campaign_influencer_id: row.id,
        influencer_id: row.influencer_id,
        brand_id: camp.brand_id ?? null,
        item: 'Beneficios de campaña',
        estimated_value: totalValue || null,
        currency: camp.currency ?? 'CLP',
        created_by: user.id,
        status: 'pactado',
        simple_status: 'pending',
      })))

      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 500 })
      }
    }

    return NextResponse.json({ data: { created: missing.length } }, { status: 201 })
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

  if (Array.isArray(benefits) && benefits.length > 0) {
    const benefitRows = buildBenefitRows(benefits, {
      organizationId: camp.organization_id,
      barterId: data.id,
      defaultCurrency: (currency as string) ?? 'CLP',
    })

    if ('error' in benefitRows) {
      await admin.from('barters').delete().eq('id', data.id)
      return NextResponse.json({ error: benefitRows.error }, { status: 422 })
    }

    const { error: benefitsError } = await admin.from('barter_benefits').insert(benefitRows.rows)
    if (benefitsError) {
      await admin.from('barters').delete().eq('id', data.id)
      return NextResponse.json({ error: benefitsError.message }, { status: 500 })
    }
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

  const { data: created } = await admin
    .from('barters')
    .select(SELECT)
    .eq('id', data.id)
    .single()

  return NextResponse.json({ data: created ?? data }, { status: 201 })
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
  const campaign = await getAccessibleCampaign(admin, user.id, user.user_metadata, params.id)
  if (!campaign) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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
    if ('simple_status' in patch && !['pending', 'completed', 'problem'].includes(String(patch.simple_status))) {
      return NextResponse.json({ error: 'Estado simple inválido' }, { status: 422 })
    }

    if ('benefit_tracking' in patch) {
      const validated = normalizeBenefitTracking(patch.benefit_tracking)
      if (!validated) return NextResponse.json({ error: 'Seguimiento de beneficios inválido' }, { status: 422 })
      patch.benefit_tracking = validated
    }

    const allowed = ['item', 'description', 'estimated_value', 'currency',
      'agreed_date', 'responsible_id', 'brand_id', 'notes', 'evidence_url', 'simple_status', 'benefit_tracking']
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
    campaign_benefits: campaign.campaign_benefits ?? [],
    history: [...((data as any).history ?? [])].sort(
      (a: any, z: any) => (a.created_at < z.created_at ? -1 : 1)
    ),
  }

  return NextResponse.json({ data: normalized })
}

function normalizeBenefitTracking(value: unknown) {
  if (!Array.isArray(value) || value.length > 100) return null
  const statuses = new Set(['pending', 'completed', 'problem'])
  const rows = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return null
    const row = raw as Record<string, unknown>
    const benefitIndex = Number(row.benefit_index)
    const status = String(row.status ?? '')
    if (!Number.isInteger(benefitIndex) || benefitIndex < 0 || !statuses.has(status)) return null
    rows.push({
      benefit_index: benefitIndex,
      status,
      note: String(row.note ?? '').trim().slice(0, 300),
      updated_at: new Date().toISOString(),
    })
  }
  return rows
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
  const campaign = await getAccessibleCampaign(admin, user.id, user.user_metadata, params.id)
  if (!campaign) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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


async function getAccessibleCampaign(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  userMeta: Record<string, unknown> | undefined,
  campaignId: string
) {
  const orgId = await getOrgId(userId, userMeta, admin)
  if (!orgId) return null

  const { data } = await admin
    .from('campaigns')
    .select('id, organization_id, brand_id, name, currency, campaign_benefits')
    .eq('id', campaignId)
    .eq('organization_id', orgId)
    .maybeSingle()

  return data
}


type BenefitInput = {
  benefit_type?: unknown
  description?: unknown
  fixed_value?: unknown
  currency?: unknown
  commission_rate?: unknown
  affiliate_link_id?: unknown
}

const BENEFIT_TYPES = new Set([
  'product', 'experience', 'meal', 'ticket', 'gift_card',
  'service', 'sales_commission', 'other',
])

function buildBenefitRows(
  rawBenefits: unknown[],
  options: { organizationId: string; barterId: string; defaultCurrency: string }
): { rows: Record<string, unknown>[] } | { error: string } {
  const rows: Record<string, unknown>[] = []

  for (let index = 0; index < rawBenefits.length; index += 1) {
    const benefit = rawBenefits[index] as BenefitInput
    const type = String(benefit?.benefit_type ?? '')
    if (!BENEFIT_TYPES.has(type)) {
      return { error: `Tipo de beneficio inválido en la posición ${index + 1}` }
    }

    const isCommission = type === 'sales_commission'
    const fixedValue = benefit.fixed_value == null || benefit.fixed_value === ''
      ? null
      : Number(benefit.fixed_value)
    const commissionRate = benefit.commission_rate == null || benefit.commission_rate === ''
      ? null
      : Number(benefit.commission_rate)

    if (isCommission && (!commissionRate || commissionRate <= 0 || commissionRate > 100)) {
      return { error: 'La comisión debe ser mayor a 0% y menor o igual a 100%' }
    }
    if (!isCommission && (fixedValue == null || !Number.isFinite(fixedValue) || fixedValue < 0)) {
      return { error: 'Cada beneficio fijo debe tener un valor válido' }
    }

    rows.push({
      organization_id: options.organizationId,
      barter_id: options.barterId,
      benefit_type: type,
      description: typeof benefit.description === 'string' ? benefit.description.trim() || null : null,
      fixed_value: isCommission ? null : fixedValue,
      currency: typeof benefit.currency === 'string' ? benefit.currency : options.defaultCurrency,
      commission_rate: isCommission ? commissionRate : null,
      affiliate_link_id: isCommission && typeof benefit.affiliate_link_id === 'string'
        ? benefit.affiliate_link_id
        : null,
      position: index,
    })
  }

  return { rows }
}
