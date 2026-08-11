import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId, getUserRole, resolveBrandAccess } from '@/lib/supabase/ensureOrg'
import { isDeliverableComplete } from '@/lib/deliverable-status'
import { getCampaignCoverUrls } from '@/lib/campaign-cover'

// ── GET /api/campaigns ────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  // Authenticate via regular client (respects cookies/session)
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const status     = searchParams.get('status')
  const type       = searchParams.get('type')
  const platform   = searchParams.get('platform')
  const visibility = searchParams.get('visibility')
  const brandId    = searchParams.get('brandId')
  const search     = searchParams.get('search')
  const dateFrom   = searchParams.get('date_from')
  const dateTo     = searchParams.get('date_to')
  const page       = parseInt(searchParams.get('page') ?? '1', 10)
  const limit      = parseInt(searchParams.get('limit') ?? '50', 10)
  const summary    = searchParams.get('summary') === '1'

  // Use admin client to bypass RLS — we apply our own filtering below
  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)

  let query = summary
    ? admin.from('campaigns').select('id, status, budget_total, budget_spent').limit(5000)
    : admin.from('campaigns')
      .select('*, brand:brands!brand_id(id, name, logo_url)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1)

  // Scope: admin/super_admin/owner de Scence ve todas las campañas. Una marca
  // jamás hereda la vista global solo por compartir organization_id con otra
  // marca o con Scence: se limita a su marca principal y a colaboraciones
  // reales. Esto protege también llamadas directas a esta API, no solo la UI.
  const { isAdmin } = orgId ? await getUserRole(user.id, orgId, admin) : { isAdmin: false }
  if (isAdmin) {
    // sin filtro de organization_id: vista global
  } else {
    const brandAccess = await resolveBrandAccess(user.id)
    if (brandAccess) {
      const { data: collaboratorRows, error: collaboratorError } = await admin
        .from('campaign_brands')
        .select('campaign_id')
        .eq('brand_id', brandAccess.brandId)
      if (collaboratorError) {
        return NextResponse.json({ error: collaboratorError.message }, { status: 500 })
      }
      const collaboratorCampaignIds = (collaboratorRows ?? [])
        .map(row => row.campaign_id)
        .filter(Boolean)
      const brandFilter = collaboratorCampaignIds.length
        ? `brand_id.eq.${brandAccess.brandId},id.in.(${collaboratorCampaignIds.join(',')})`
        : `brand_id.eq.${brandAccess.brandId}`
      query = query.or(brandFilter)
    } else if (orgId) {
      query = query.eq('organization_id', orgId)
    } else {
      query = query.eq('created_by', user.id)
    }
  }

  if (status)     query = query.eq('status', status)
  if (type)       query = query.eq('type', type)
  if (platform)   query = query.contains('platforms', [platform])
  if (visibility) query = query.eq('visibility', visibility)
  if (search)     query = query.ilike('name', `%${search}%`)
  if (dateFrom)   query = query.gte('start_date', dateFrom)
  if (dateTo)     query = query.lte('start_date', dateTo)

  // Filtro por marca: incluye tanto la marca principal (brand_id) como
  // co-marcas colaboradoras (campaign_brands) — mismo criterio que ya usa
  // /api/brand/campaigns para resolver "mis campañas" desde el lado marca.
  if (brandId) {
    const { data: coBrandRows } = await admin
      .from('campaign_brands')
      .select('campaign_id')
      .eq('brand_id', brandId)
    const coBrandCampaignIds = (coBrandRows ?? []).map(r => r.campaign_id)
    const orFilter = coBrandCampaignIds.length
      ? `brand_id.eq.${brandId},id.in.(${coBrandCampaignIds.join(',')})`
      : `brand_id.eq.${brandId}`
    query = query.or(orFilter)
  }

  const { data, error, count } = await query

  if (error) {
    console.error('[GET /api/campaigns]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const campaignIds = (data ?? []).map(c => c.id)

  if (summary) {
    const [deliverablesResult, pendingApprovalResult] = await Promise.all([
      campaignIds.length
        ? admin.from('campaign_deliverables')
          .select('campaign_id, status, content_url, published_url')
          .in('campaign_id', campaignIds)
        : Promise.resolve({ data: [], error: null }),
      admin.from('campaigns')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending_approval'),
    ])
    const { data: deliverables, error: deliverablesError } = deliverablesResult
    if (deliverablesError) {
      return NextResponse.json({ error: deliverablesError.message }, { status: 500 })
    }
    const pendingDeliverables = (deliverables ?? []).reduce(
      (total, row) => total + (isDeliverableComplete(row) ? 0 : 1),
      0
    )
    return NextResponse.json({
      summary: {
        active: (data ?? []).filter(c => c.status === 'active').length,
        totalBudget: (data ?? []).reduce((total, c) => total + (c.budget_total ?? 0), 0),
        totalSpent: (data ?? []).reduce((total, c) => total + (c.budget_spent ?? 0), 0),
        pendingDeliverables,
        pendingApprovalCount: pendingApprovalResult.count ?? 0,
      },
    })
  }

  // Batch-fetch influencer counts and deliverable counts for this page
  const [{ data: ciRows }, { data: cdRows }] = await Promise.all([
    campaignIds.length
      // Participantes = solo postulaciones/invitaciones ACEPTADas. Las filas
      // pending (postulantes/invitadas sin aceptar) o rejected NO cuentan.
      ? admin.from('campaign_influencers').select('campaign_id').in('campaign_id', campaignIds).eq('application_status', 'accepted')
      : { data: [] },
    campaignIds.length
      ? admin.from('campaign_deliverables').select('campaign_id, status, content_url, published_url').in('campaign_id', campaignIds)
      : { data: [] },
  ])

  // Build count maps
  const infCount: Record<string, number> = {}
  for (const r of ciRows ?? []) {
    infCount[r.campaign_id] = (infCount[r.campaign_id] ?? 0) + 1
  }
  const delCount: Record<string, number> = {}
  const delDone:  Record<string, number> = {}
  for (const r of cdRows ?? []) {
    delCount[r.campaign_id] = (delCount[r.campaign_id] ?? 0) + 1
    // Mismo criterio único de "completado" que el resto de la app (ver
    // src/lib/deliverable-status.ts) — antes solo miraba status
    // published/approved, sin contar entregas ya subidas pero aún en revisión.
    if (isDeliverableComplete(r)) {
      delDone[r.campaign_id] = (delDone[r.campaign_id] ?? 0) + 1
    }
  }

  const coverUrls = await getCampaignCoverUrls(admin, campaignIds)
  const enriched = (data ?? []).map(c => ({
    ...c,
    cover_url:         coverUrls.get(c.id) ?? null,
    influencer_count:  infCount[c.id]  ?? 0,
    deliverable_count: delCount[c.id]  ?? 0,
    deliverable_done:  delDone[c.id]   ?? 0,
  }))

  return NextResponse.json({ data: enriched, total: count ?? 0, page, limit })
}

// ── POST /api/campaigns ───────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // El portal de marca usa /api/brand/campaigns, que siempre crea en draft y
  // aplica el control de plan. Bloquear la ruta administrativa genérica evita
  // que una marca la invoque directamente con status='active'.
  if (user.user_metadata?.is_brand) {
    return NextResponse.json(
      { error: 'Las marcas deben crear campañas desde su portal' },
      { status: 403 },
    )
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const {
    name,
    description,
    type,
    status = 'draft',
    start_date,
    end_date,
    budget_total,
    currency = 'CLP',
    goals,
    hashtags,
    social_tags,
    platforms,
    content_guidelines,
    approval_required = true,
    tags,
    brief_url,
    brand_id,
    commission_rate,
    deliverable_templates,
    campaign_benefits,
    organization_id,
    address,
    application_questions,
    visibility = 'private',
    application_deadline,
    max_influencers,
  } = body as Record<string, unknown>

  // Validate required fields
  if (!name || typeof name !== 'string' || name.trim() === '') {
    return NextResponse.json({ error: 'name is required' }, { status: 422 })
  }
  if (!type) {
    return NextResponse.json({ error: 'type is required' }, { status: 422 })
  }

  const admin = createAdminClient()
  // Use getOrgId for reliable resolution — falls back to DB if JWT metadata is stale
  const orgId = (organization_id as string) ?? await getOrgId(user.id, user.user_metadata, admin)

  if (!orgId) {
    return NextResponse.json({ error: 'Organización no encontrada. Recarga la página.' }, { status: 400 })
  }

  const { data, error } = await admin
    .from('campaigns')
    .insert({
      name: (name as string).trim(),
      description: description ?? null,
      type,
      status,
      start_date: start_date && String(start_date).trim() ? start_date : null,
      end_date: end_date && String(end_date).trim() ? end_date : null,
      // Allow 0 budget (commission campaigns); only skip if undefined/null
      budget_total: (budget_total !== undefined && budget_total !== null && budget_total !== '') ? Number(budget_total) : null,
      budget_spent: 0,
      currency,
      goals: goals ?? {},
      hashtags: hashtags ?? [],
      mention_handles: social_tags ?? [],
      platforms: platforms ?? [],
      content_guidelines: content_guidelines ?? null,
      approval_required,
      tags: tags ?? [],
      brief_url: brief_url ?? null,
      brand_id: brand_id ?? null,
      commission_rate: commission_rate ?? null,
      metadata: {
        address: (address !== undefined && address !== null && String(address).trim() !== '')
          ? String(address).trim()
          : null,
      },
      deliverable_templates: Array.isArray(deliverable_templates) && (deliverable_templates as unknown[]).length > 0
        ? deliverable_templates
        : [],
      campaign_benefits: normalizeCampaignBenefits(campaign_benefits),
      // Preguntas obligatorias (pública: para postular / privada: para
      // aceptar invitación) — opcionales en cualquier visibilidad.
      application_questions: Array.isArray(application_questions)
        ? (application_questions as unknown[]).map(q => String(q ?? '').trim()).filter(Boolean)
        : [],
      visibility,
      application_deadline: visibility === 'open' ? (application_deadline || null) : null,
      max_influencers: visibility === 'open' && max_influencers ? Number(max_influencers) : null,
      organization_id: orgId,
      created_by: user.id,
    })
    .select()
    .single()

  if (error) {
    console.error('[POST /api/campaigns]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data }, { status: 201 })
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
