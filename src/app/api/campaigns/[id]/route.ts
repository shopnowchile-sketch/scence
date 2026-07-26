import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId, getUserRole } from '@/lib/supabase/ensureOrg'
import { notifyAllInfluencersOfOpenCampaign, notifyPreassignedInfluencersOnActivation } from '@/lib/campaign-notifications'

// Margen extra: al activar una campaña pública este endpoint puede enviar
// el aviso a todas las influencers del sistema (en batches) antes de responder.
export const maxDuration = 60

type Params = { params: { id: string } }

async function getBrandCampaignAccess(admin: any, userId: string, campaignId: string) {
  const { data: brand } = await admin
    .from('brands')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle()

  if (!brand?.id) return { isBrand: false, canView: false, canEdit: false, brandId: null }

  const { data: campaign } = await admin
    .from('campaigns')
    .select('id, brand_id, created_by_brand_id')
    .eq('id', campaignId)
    .maybeSingle()

  if (!campaign) return { isBrand: true, canView: false, canEdit: false, brandId: brand.id }

  const isMainBrand = campaign.brand_id === brand.id
  const isCreatorBrand = campaign.created_by_brand_id === brand.id

  return {
    isBrand: true,
    canView: isMainBrand || isCreatorBrand,
    canEdit: isMainBrand || isCreatorBrand,
    brandId: brand.id,
  }
}

async function getBrandAccess(admin: ReturnType<typeof createAdminClient>, userId: string, campaignId: string) {
  const { data: profileBrand } = await admin
    .from('brands')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle()

  if (!profileBrand?.id) return { isBrand: false, canView: false, canEdit: false }

  const { data: campaign } = await admin
    .from('campaigns')
    .select('id, brand_id, created_by_brand_id')
    .eq('id', campaignId)
    .maybeSingle()

  if (!campaign) return { isBrand: true, canView: false, canEdit: false }

  const isMain = campaign.brand_id === profileBrand.id
  const isCreator = campaign.created_by_brand_id === profileBrand.id || campaign.brand_id === profileBrand.id

  return {
    isBrand: true,
    canView: isMain || isCreator,
    canEdit: isCreator,
  }
}


// ── GET /api/campaigns/[id] ───────────────────────────────────────────────────
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)

  // Reparación idempotente de datos legacy: antes algunas relaciones quedaban
  // como "pending" aun cuando ya tenían entregables/contenido. Un entregable
  // demuestra participación real, por lo que la relación debe aparecer como
  // aceptada y activa. Solo cambia filas pendientes; no toca invitaciones sin
  // trabajo ni estados que ya fueron resueltos.
  const { data: legacyDeliverables } = await admin
    .from('campaign_deliverables')
    .select('campaign_influencer_id')
    .eq('campaign_id', params.id)
    .not('campaign_influencer_id', 'is', null)

  const legacyRelationIds = Array.from(new Set(
    (legacyDeliverables ?? [])
      .map(row => row.campaign_influencer_id)
      .filter((value): value is string => Boolean(value)),
  ))

  if (legacyRelationIds.length > 0) {
    await admin
      .from('campaign_influencers')
      .update({ application_status: 'accepted', status: 'active', accepted_at: new Date().toISOString() })
      .in('id', legacyRelationIds)
      .eq('application_status', 'pending')
  }

  const { data, error } = await admin
    .from('campaigns')
    .select(`
      *,
      brand:brands!brand_id (id, name, logo_url, website, contact_name, contact_email),
      campaign_brands (
        id,
        brand:brands (id, name, logo_url, website, instagram, contact_name, contact_email)
      ),
      campaign_influencers (
        id, fee, status, notes, application_status, origin, metadata,
        influencer:influencers (
          id, display_name, email, avatar_url, city, country, commune, categories,
          influencer_social_profiles (platform, username, followers, engagement_rate)
        )
      ),
      campaign_deliverables (
        id, title, type, status, due_date, platform,
        published_at, published_url, content_url, submitted_at, review_notes, progress, content_rating,
        performance, metrics_provider, metrics_updated_at, engagement_rate,
        attendance_response, attendance_responded_at, attendance_note,
        influencer:influencers (id, display_name, avatar_url)
      )
    `)
    .eq('id', params.id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }
    console.error('[GET /api/campaigns/[id]]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // El horario y lugar del evento se guardan en bookings (no en campaigns).
  // Se incluyen en el resumen para que Admin y Marca vean la información real
  // del evento, en vez del rango general de duración de la campaña.
  const { data: eventBooking } = await admin
    .from('bookings')
    .select('id, title, starts_at, ends_at, location, location_details, status')
    .eq('campaign_id', params.id)
    .order('starts_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  const campaignWithEvent = { ...data, event_booking: eventBooking ?? null }

  if (user.user_metadata?.is_brand) {
    const access = await getBrandAccess(admin, user.id, params.id)
    if (!access.canView) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    return NextResponse.json({ data: { ...campaignWithEvent, _brand_permissions: access } })
  }

  // Mismo criterio que la lista (GET /api/campaigns): admin/super_admin/owner
  // de Scence puede abrir cualquier campaña, sin filtrar por organization_id
  // — las marcas quedan con su propia organization_id aislada. Antes esto
  // bloqueaba el detalle con 404 aunque la campaña sí apareciera en la lista.
  const { isAdmin } = orgId ? await getUserRole(user.id, orgId, admin) : { isAdmin: false }
  if (!isAdmin && orgId && data.organization_id !== orgId) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  }

  return NextResponse.json({ data: campaignWithEvent })
}

// ── PUT /api/campaigns/[id] — full update ─────────────────────────────────────
export async function PUT(request: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)

  if (user.user_metadata?.is_brand) {
    const access = await getBrandAccess(admin, user.id, params.id)
    if (!access.canEdit) return NextResponse.json({ error: 'Solo la marca creadora puede editar esta campaña' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Strip server-managed fields
  const { id: _id, created_at: _ca, created_by: _cb, organization_id: _oi, budget_spent: _bs, address, ...rest } = body

  // Refuerzo backend: una marca nunca puede reasignar la marca dueña de su
  // propia campaña, aunque el formulario ya no muestre ese campo.
  if (user.user_metadata?.is_brand) {
    delete rest.brand_id
  }

  if ('address' in body) {
    const { data: existingCampaign } = await admin
      .from('campaigns')
      .select('metadata')
      .eq('id', params.id)
      .maybeSingle()

    const existingMetadata =
      existingCampaign?.metadata &&
      typeof existingCampaign.metadata === 'object' &&
      !Array.isArray(existingCampaign.metadata)
        ? (existingCampaign.metadata as Record<string, unknown>)
        : {}

    const incomingMetadata =
      rest.metadata &&
      typeof rest.metadata === 'object' &&
      !Array.isArray(rest.metadata)
        ? (rest.metadata as Record<string, unknown>)
        : {}

    rest.metadata = {
      ...existingMetadata,
      ...incomingMetadata,
      address:
        address !== undefined &&
        address !== null &&
        String(address).trim() !== ''
          ? String(address).trim()
          : null,
    }
  }

  // Scope update to the user's own org — salvo admin/super_admin/owner de
  // Scence, que puede editar cualquier campaña (mismo criterio que GET).
  const { isAdmin } = orgId ? await getUserRole(user.id, orgId, admin) : { isAdmin: false }
  let query = admin
    .from('campaigns')
    .update({ ...rest, updated_at: new Date().toISOString() })
    .eq('id', params.id)

  if (!isAdmin && orgId) query = query.eq('organization_id', orgId)

  const { data, error } = await query.select().single()

  if (error) {
    if (error.code === 'PGRST116') return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    console.error('[PUT /api/campaigns/[id]]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data })
}

// ── PATCH /api/campaigns/[id] — partial update / status change ────────────────
export async function PATCH(request: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)

  if (user.user_metadata?.is_brand) {
    const access = await getBrandAccess(admin, user.id, params.id)
    if (!access.canEdit) return NextResponse.json({ error: 'Solo la marca creadora puede editar esta campaña' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { action, address, ...fields } = body

  if ('campaign_benefits' in fields) {
    fields.campaign_benefits = normalizeCampaignBenefits(fields.campaign_benefits)
  }

  // Refuerzo backend: una marca nunca puede reasignar la marca dueña de su
  // propia campaña vía PATCH, aunque el formulario ya no muestre ese campo.
  if (user.user_metadata?.is_brand) {
    delete fields.brand_id
  }

  // Handle named actions
  if (action === 'pause') {
    fields.status = 'paused'
  } else if (action === 'activate') {
    fields.status = 'active'
  } else if (action === 'complete') {
    fields.status = 'completed'
  } else if (action === 'cancel') {
    fields.status = 'canceled'
  } else if (action === 'submit_for_approval') {
    fields.status = 'pending_approval'
  } else if (action === 'close_applications') {
    fields.applications_closed_at = new Date().toISOString()
  } else if (action === 'reopen_applications') {
    fields.applications_closed_at = null
  }

  if ('address' in body) {
    const { data: existingCampaign } = await admin
      .from('campaigns')
      .select('metadata')
      .eq('id', params.id)
      .maybeSingle()

    const existingMetadata =
      existingCampaign?.metadata &&
      typeof existingCampaign.metadata === 'object' &&
      !Array.isArray(existingCampaign.metadata)
        ? (existingCampaign.metadata as Record<string, unknown>)
        : {}

    const incomingMetadata =
      fields.metadata &&
      typeof fields.metadata === 'object' &&
      !Array.isArray(fields.metadata)
        ? (fields.metadata as Record<string, unknown>)
        : {}

    fields.metadata = {
      ...existingMetadata,
      ...incomingMetadata,
      address:
        address !== undefined &&
        address !== null &&
        String(address).trim() !== ''
          ? String(address).trim()
          : null,
    }
  }

  // Scope update to the user's own org — salvo admin/super_admin/owner de
  // Scence, que puede cambiar el estado de cualquier campaña.
  const { isAdmin } = orgId ? await getUserRole(user.id, orgId, admin) : { isAdmin: false }
  let query = admin
    .from('campaigns')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', params.id)

  if (!isAdmin && orgId) query = query.eq('organization_id', orgId)

  const { data, error } = await query.select().single()

  if (error) {
    if (error.code === 'PGRST116') return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    console.error('[PATCH /api/campaigns/[id]]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // ── Auto-generate draft invoice when campaign is completed ────────────────
  if (action === 'complete' && data && orgId) {
    try {
      const campaign = data as Record<string, unknown>
      // Build invoice number: INV-{year}-{random 4 digits}
      const invoiceNumber = `INV-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`
      const budgetTotal   = (campaign.budget_total as number) ?? 0
      const taxRate       = 0   // 0% default; user can edit
      const taxAmount     = budgetTotal * taxRate
      const total         = budgetTotal + taxAmount

      await admin.from('invoices').insert({
        organization_id: orgId,
        campaign_id:     params.id,
        brand_id:        (campaign.brand_id as string) ?? null,
        invoice_number:  invoiceNumber,
        status:          'draft',
        subtotal:        budgetTotal,
        tax_rate:        taxRate,
        tax_amount:      taxAmount,
        discount_amount: 0,
        total,
        currency:        (campaign.currency as string) ?? 'CLP',
        issue_date:      new Date().toISOString().split('T')[0],
        due_date:        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        issued_by:       user.id,
        notes:           `Factura generada automáticamente al completar campaña "${campaign.name as string}".`,
        metadata: {
          campaign_name:   campaign.name,
          auto_generated:  true,
        },
      })
    } catch (e) {
      // Non-fatal — invoice creation failure should not block campaign completion
      console.error('[auto-invoice] failed to create invoice on campaign complete:', e)
    }
  }

  // ── Avisa a todas las influencers del sistema cuando se activa una
  // campaña pública (visibility=open). Reutiliza el mismo template y la
  // misma tabla de idempotencia que el botón manual de notificación —
  // si alguien ya fue avisada (por este envío o por el botón manual) no
  // se le vuelve a escribir. No bloquea la respuesta si falla el email.
  if (action === 'activate' && data) {
    // Se espera (await) a propósito: en un entorno serverless el proceso
    // puede cortarse apenas se devuelve la respuesta, así que un
    // "fire and forget" arriesga a que el envío nunca se complete.
    // Ambas funciones capturan sus propios errores — nunca lanzan.

    // Preasignadas en draft (invitaciones pendientes + altas directas): se les
    // avisa una sola vez al activar (los emails se difieren mientras es draft).
    await notifyPreassignedInfluencersOnActivation(params.id, admin)

    // Pública: además avisa al resto de la base (excluye a las preasignadas,
    // así que no hay email duplicado). Misma tabla de idempotencia.
    if ((data as Record<string, unknown>).visibility === 'open') {
      await notifyAllInfluencersOfOpenCampaign(params.id, admin)
    }
  }

  return NextResponse.json({ data })
}

function normalizeCampaignBenefits(value: unknown) {
  if (!Array.isArray(value)) return []
  const types = new Set(['product', 'experience', 'meal', 'ticket', 'gift_card', 'service', 'sales_commission', 'other'])
  const rules = new Set(['deliverables_completed', 'sales_target', 'attendance', 'accepted', 'manual', 'raffle'])
  return value.flatMap(raw => {
    if (!raw || typeof raw !== 'object') return []
    const benefit = raw as Record<string, unknown>
    const benefitType = String(benefit.benefit_type ?? '')
    const activationRule = String(benefit.activation_rule ?? '')
    const description = String(benefit.description ?? '').trim()
    if (!types.has(benefitType) || !rules.has(activationRule) || !description) return []
    return [{
      benefit_type: benefitType,
      description,
      quantity: Math.max(1, Math.trunc(Number(benefit.quantity) || 1)),
      estimated_value: benefit.estimated_value == null ? null : Math.max(0, Number(benefit.estimated_value) || 0),
      commission_rate: benefitType === 'sales_commission' ? Math.min(100, Math.max(0, Number(benefit.commission_rate) || 0)) : null,
      currency: typeof benefit.currency === 'string' ? benefit.currency : 'CLP',
      activation_rule: activationRule,
      sales_target: activationRule === 'sales_target' ? Math.max(1, Math.trunc(Number(benefit.sales_target) || 1)) : null,
    }]
  })
}

// ── DELETE /api/campaigns/[id] ────────────────────────────────────────────────
// ?hard=1 → borrado permanente (solo admin/super_admin/owner). Sin ese
// parámetro, se mantiene el comportamiento original: soft-delete (canceled).
export async function DELETE(req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)

  if (user.user_metadata?.is_brand) {
    const access = await getBrandAccess(admin, user.id, params.id)
    if (!access.canEdit) return NextResponse.json({ error: 'Solo la marca creadora puede editar esta campaña' }, { status: 403 })
  }

  const { isAdmin } = orgId ? await getUserRole(user.id, orgId, admin) : { isAdmin: false }

  const hard = new URL(req.url).searchParams.get('hard') === '1'

  if (hard) {
    // Borrado permanente: nunca disponible para marcas, solo para
    // admin/super_admin/owner de Scence.
    if (!isAdmin) {
      return NextResponse.json({ error: 'Solo un administrador puede borrar una campaña por completo' }, { status: 403 })
    }

    const [{ count: facturas }, { count: payroll }] = await Promise.all([
      admin.from('invoices').select('id', { count: 'exact', head: true }).eq('campaign_id', params.id),
      admin.from('payroll_runs').select('id', { count: 'exact', head: true }).eq('campaign_id', params.id),
    ])

    const confirmBilling = req.headers.get('x-confirm-billing') === '1'
    if (((facturas ?? 0) > 0 || (payroll ?? 0) > 0) && !confirmBilling) {
      return NextResponse.json(
        { requiresConfirmation: true, facturas: facturas ?? 0, payroll: payroll ?? 0 },
        { status: 409 }
      )
    }

    // Los FKs de campaigns ya definen el comportamiento en DB: tablas
    // operativas (campaign_influencers, campaign_brands, deliverables,
    // assets, notifications, status_history) se borran en cascada;
    // facturas/payroll/barters/bookings/etc. quedan con campaign_id = null.
    const { error: hardError } = await admin.from('campaigns').delete().eq('id', params.id)

    if (hardError) {
      console.error('[DELETE /api/campaigns/[id]?hard=1]', hardError)
      return NextResponse.json({ error: hardError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, hard: true })
  }

  // Soft-delete: set status to canceled rather than hard delete
  // Scope to user's org for security — salvo admin/super_admin/owner de
  // Scence, que puede eliminar cualquier campaña.
  let query = admin
    .from('campaigns')
    .update({ status: 'canceled', updated_at: new Date().toISOString() })
    .eq('id', params.id)

  if (!isAdmin && orgId) query = query.eq('organization_id', orgId)

  const { error } = await query

  if (error) {
    console.error('[DELETE /api/campaigns/[id]]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
