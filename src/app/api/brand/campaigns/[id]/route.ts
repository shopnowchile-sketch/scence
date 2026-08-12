import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { resolveBrandAccess } from '@/lib/supabase/ensureOrg'
import {
  campaignLimitMessage,
  getPlanLimits,
  PLAN_ERROR_CODES,
  resolveBrandPlan,
  visibilityLimitMessage,
} from '@/lib/plan-limits'

type Params = { params: { id: string } }

// GET /api/brand-campaigns/[id] — detalle solo para la marca creadora.
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!user.user_metadata?.is_brand) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()

  const access = await resolveBrandAccess(user.id)
  if (!access) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })
  const brand = { id: access.brandId }

  const { data: campaignBase, error: baseError } = await admin
    .from('campaigns')
    .select('id, brand_id, created_by_brand_id')
    .eq('id', params.id)
    .single()

  if (baseError) {
    if (baseError.code === 'PGRST116') return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })
    return NextResponse.json({ error: baseError.message }, { status: 500 })
  }

  const canEdit =
    campaignBase.brand_id === brand.id ||
    campaignBase.created_by_brand_id === brand.id

  if (!canEdit) return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })

  const { data, error } = await admin
    .from('campaigns')
    .select(`
      *,
      brand:brands!brand_id (id, name, logo_url, website, contact_name, contact_email),
      campaign_brands (
        id, role,
        brand:brands (id, name, logo_url, instagram)
      ),
      campaign_influencers (
        id, application_status, status, origin, message, fee, currency, notes,
        influencer:influencers (
          id, display_name, email, avatar_url, city, country, commune, categories, rating,
          influencer_social_profiles (platform, username, followers, engagement_rate)
        )
      ),
      campaign_deliverables (
        id, title, type, status, due_date, platform,
        content_url, submitted_at, published_url, published_at, review_notes, progress,
        attendance_response, attendance_responded_at, attendance_note,
        influencer:influencers (id, display_name, avatar_url)
      )
    `)
    .eq('id', params.id)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const metadata =
    data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata)
      ? data.metadata as Record<string, unknown>
      : {}
  const { data: eventBookings } = await admin
    .from('bookings')
    .select('id, title, starts_at, ends_at, location, location_details, status')
    .eq('campaign_id', params.id)
    .order('starts_at', { ascending: true })

  return NextResponse.json({
    data: {
      ...data,
      address: typeof metadata.address === 'string' ? metadata.address : null,
      // Misma agenda que el detalle admin: una campaña de varios días tiene
      // múltiples bookings de campaña, no un rango sintético.
      event_booking: eventBookings?.[0] ?? null,
      event_bookings: eventBookings ?? [],
      _brand_permissions: {
        isBrand: true,
        canView: true,
        canEdit,
        brandId: brand.id,
      },
    },
  })
}


// PATCH /api/brand/campaigns/[id] — editar campaña desde marca dueña
export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!user.user_metadata?.is_brand) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()

  const access = await resolveBrandAccess(user.id)
  if (!access) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })
  const brand = { id: access.brandId }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const allowed = [
    'status',
    'name',
    'description',
    'type',
    'platforms',
    'start_date',
    'end_date',
    'budget_total',
    'commission_rate',
    'currency',
    'content_guidelines',
    'mention_handles',
    'hashtags',
    'deliverable_templates',
    'approval_required',
    'visibility',
    'application_deadline',
    'max_influencers',
    'brief_url',
  ]

  const updates: Record<string, unknown> = {}

  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  if ('social_tags' in body) updates.mention_handles = body.social_tags

  const statusByAction: Record<string, string> = {
    submit_for_approval: 'pending_approval',
    pause: 'paused',
    complete: 'completed',
  }

  if (typeof body.action === 'string' && statusByAction[body.action]) {
    updates.status = statusByAction[body.action]
  }

  // La marca nunca publica por su cuenta. Su única transición hacia
  // publicación es enviar a revisión; un administrador decide la activación.
  if (body.action === 'activate' || body.status === 'active') {
    return NextResponse.json({ error: 'La campaña debe ser aprobada por un administrador antes de activarse' }, { status: 403 })
  }

  if (body.action === 'close_applications') {
    updates.applications_closed_at = new Date().toISOString()
  } else if (body.action === 'reopen_applications') {
    updates.applications_closed_at = null
  }

  if (typeof updates.name === 'string') {
    const name = updates.name.trim()
    if (!name) return NextResponse.json({ error: 'El nombre es requerido' }, { status: 422 })
    updates.name = name
  }

  if (updates.visibility && !['private', 'open'].includes(String(updates.visibility))) {
    return NextResponse.json({ error: 'visibility debe ser private u open' }, { status: 422 })
  }

  if (updates.status && !['draft', 'pending_approval', 'active', 'paused', 'completed', 'canceled'].includes(String(updates.status))) {
    return NextResponse.json({ error: 'status inválido' }, { status: 422 })
  }

  const { data: campaignBase, error: baseError } = await admin
    .from('campaigns')
    .select('id, brand_id, created_by_brand_id, organization_id, status, visibility, metadata')
    .eq('id', params.id)
    .single()

  if (baseError) {
    if (baseError.code === 'PGRST116') {
      return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })
    }
    return NextResponse.json({ error: baseError.message }, { status: 500 })
  }

  const canEdit =
    campaignBase.brand_id === brand.id ||
    campaignBase.created_by_brand_id === brand.id

  if (!canEdit) {
    return NextResponse.json(
      { error: 'Solo la marca creadora puede editar esta campaña' },
      { status: 403 },
    )
  }

  if (body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)) {
    updates.metadata = {
      ...((campaignBase.metadata as Record<string, unknown> | null) ?? {}),
      ...(body.metadata as Record<string, unknown>),
    }
  }

  // La dirección es el fallback de campaña cuando todavía no existe un
  // booking. Mantiene la misma lectura/escritura que el detalle admin y no
  // crea un segundo campo para el portal de marca.
  if ('address' in body) {
    updates.metadata = {
      ...((campaignBase.metadata as Record<string, unknown> | null) ?? {}),
      ...((updates.metadata as Record<string, unknown> | undefined) ?? {}),
      address: body.address == null || String(body.address).trim() === ''
        ? null
        : String(body.address).trim(),
    }
  }

  const orgPlan = await resolveBrandPlan(admin, campaignBase.organization_id, brand.id)
  const limits = getPlanLimits(orgPlan)

  const nextVisibility =
    typeof updates.visibility === 'string'
      ? updates.visibility
      : campaignBase.visibility

  if (
    nextVisibility === 'open' &&
    campaignBase.visibility !== 'open' &&
    !limits.can_create_open_campaigns
  ) {
    const { count: previousOpenCount, error: openCountError } = await admin
      .from('campaigns')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brand.id)
      .eq('visibility', 'open')
      .neq('id', params.id)

    if (openCountError) {
      return NextResponse.json({ error: openCountError.message }, { status: 500 })
    }

    if ((previousOpenCount ?? 0) > 0) {
      return NextResponse.json({
        error: visibilityLimitMessage(orgPlan),
        code: PLAN_ERROR_CODES.VISIBILITY_LIMIT,
        plan: orgPlan,
      }, { status: 403 })
    }
  }

  if (updates.status === 'active' && campaignBase.status !== 'active') {
    const { count: otherCampaignCount, error: campaignCountError } = await admin
      .from('campaigns')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brand.id)
      .neq('id', params.id)
      .eq('status', 'active')

    if (campaignCountError) {
      return NextResponse.json({ error: campaignCountError.message }, { status: 500 })
    }

    if ((otherCampaignCount ?? 0) >= limits.max_active_campaigns) {
      return NextResponse.json({
        error: campaignLimitMessage(orgPlan),
        code: PLAN_ERROR_CODES.CAMPAIGN_LIMIT,
        plan: orgPlan,
      }, { status: 403 })
    }
  }

  if ('address' in body) {
    const existingMetadata =
      campaignBase.metadata &&
      typeof campaignBase.metadata === 'object' &&
      !Array.isArray(campaignBase.metadata)
        ? (campaignBase.metadata as Record<string, unknown>)
        : {}

    const normalizedAddress =
      body.address !== undefined &&
      body.address !== null &&
      String(body.address).trim() !== ''
        ? String(body.address).trim()
        : null

    updates.metadata = {
      ...existingMetadata,
      address: normalizedAddress,
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: 'No se recibieron cambios para actualizar' },
      { status: 422 },
    )
  }

  const { data, error } = await admin
    .from('campaigns')
    .update(updates)
    .eq('id', params.id)
    .select('id, name, status, visibility')
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })
    }
    console.error('[PATCH /api/brand/campaigns/[id]]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data })
}

export const PUT = PATCH
