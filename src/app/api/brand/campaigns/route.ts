import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import {
  resolveBrandPlan,
  getPlanLimits,
  visibilityLimitMessage,
  PLAN_ERROR_CODES,
} from '@/lib/plan-limits'
import { isDeliverableComplete } from '@/lib/deliverable-status'
import { resolveBrandAccess } from '@/lib/supabase/ensureOrg'
import type { DeliverableTemplateInput } from '@/lib/deliverable-templates'
import { getCampaignCoverUrls } from '@/lib/campaign-cover'

// GET /api/brand-campaigns — campañas de la marca autenticada
// Acepta los mismos filtros que /api/campaigns (status/type/platform/visibility/search)
// para que CampaignsClient.tsx (compartido admin/marca) funcione igual en ambos portales.
export async function GET(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!user.user_metadata?.is_brand) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sp         = req.nextUrl.searchParams
  const status     = sp.get('status')
  const type       = sp.get('type')
  const platform   = sp.get('platform')
  const visibility = sp.get('visibility')
  const search     = sp.get('search')
  const dateFrom   = sp.get('date_from')
  const dateTo     = sp.get('date_to')

  const admin = createAdminClient()

  // Resolver brand: owner o miembro activo de brand_members (multiusuario
  // por marca, spec Pri 2026-07-10 — reemplaza el filtro exclusivo por
  // brands.user_id).
  const access = await resolveBrandAccess(user.id)
  if (!access) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })

  const { data: brand } = await admin
    .from('brands')
    .select('id, name, organization_id')
    .eq('id', access.brandId)
    .single()

  if (!brand) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })

  const { data: coBrandRows, error: coBrandError } = await admin
    .from('campaign_brands')
    .select('campaign_id')
    .eq('brand_id', brand.id)

  if (coBrandError) {
    console.error('[GET /api/brand-campaigns] campaign_brands', coBrandError)
    return NextResponse.json({ error: coBrandError.message }, { status: 500 })
  }

  const campaignIds = Array.from(new Set([
    ...(coBrandRows ?? []).map(r => r.campaign_id),
  ].filter(Boolean)))

  const orFilter = campaignIds.length
    ? `brand_id.eq.${brand.id},id.in.(${campaignIds.join(',')})`
    : `brand_id.eq.${brand.id}`

  let query = admin
    .from('campaigns')
    .select(`
      id, name, description, type, status, visibility, application_deadline,
      max_influencers, start_date, end_date, created_at,
      budget_total, currency, hashtags, platforms, content_guidelines,
      campaign_influencers (
        id, application_status, fee, currency,
        influencer:influencers (id, display_name, avatar_url, city,
          influencer_social_profiles (platform, username, followers, engagement_rate)
        )
      ),
      campaign_deliverables (
        id, title, description, type, status, due_date, scheduled_at, sequence_number, platform,
        content_url, submitted_at, published_url, review_notes,
        influencer:influencers (id, display_name, avatar_url)
      )
    `)
    .or(orFilter)
    .order('created_at', { ascending: false })

  // Mismos filtros que /api/campaigns — antes esta ruta los ignoraba por
  // completo (CampaignsClient mandaba status/type/platform/search y acá no
  // se aplicaban, quedaban muertos del lado marca).
  if (status)     query = query.eq('status', status)
  if (type)       query = query.eq('type', type)
  if (platform)   query = query.contains('platforms', [platform])
  if (visibility) query = query.eq('visibility', visibility)
  if (search)     query = query.ilike('name', `%${search}%`)
  if (dateFrom)   query = query.gte('start_date', dateFrom)
  if (dateTo)     query = query.lte('start_date', dateTo)

  const { data, error } = await query

  if (error) {
    console.error('[GET /api/brand-campaigns]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // influencer_count/deliverable_count/deliverable_done calculados desde los
  // mismos arrays ya traídos (sin queries extra) — mismo shape que ya
  // devuelve /api/campaigns para que CampaignsClient.tsx (compartido) los
  // pinte igual en ambos portales. Se agregan sin quitar los arrays
  // anidados, porque brand-dash/page.tsx y brand/dashboard/page.tsx ya
  // dependen de ellos completos.
  type Row = { campaign_influencers?: Array<{ application_status?: string }>; campaign_deliverables?: Array<{ status: string }> }
  const coverUrls = await getCampaignCoverUrls(admin, (data ?? []).map(c => c.id))
  const enriched = (data ?? []).map(c => {
    const row = c as Row
    const deliverables = row.campaign_deliverables ?? []
    // Participantes = solo filas ACEPTADas (no pending/rejected). No se toca el
    // array anidado (brand-dash lo usa completo); solo el conteo.
    const acceptedCount = (row.campaign_influencers ?? []).filter(ci => ci.application_status === 'accepted').length
    return {
      ...c,
      cover_url: coverUrls.get(c.id) ?? null,
      influencer_count:  acceptedCount,
      deliverable_count: deliverables.length,
      deliverable_done:  deliverables.filter(isDeliverableComplete).length,
    }
  })

  return NextResponse.json({ data: enriched, total: enriched.length, brand })
}

// POST /api/brand-campaigns — crear campaña desde el portal de marca
export async function POST(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!user.user_metadata?.is_brand) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()

  const access = await resolveBrandAccess(user.id)
  if (!access) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })

  const { data: brand } = await admin
    .from('brands')
    .select('id, organization_id, status, subscription_plan_override')
    .eq('id', access.brandId)
    .single()

  if (!brand) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })
  if (brand.status !== 'approved') {
    return NextResponse.json(
      { error: 'Tu marca está pendiente de aprobación. Aún no puedes crear campañas.' },
      { status: 403 }
    )
  }

  // Misma regla comercial que /api/brand/me:
  // una suscripción active/trialing O un override administrativo válido
  // habilitan la creación de campañas.
  const { data: activeSubscription } = await admin
    .from('subscriptions')
    .select('id')
    .eq('organization_id', brand.organization_id)
    .in('status', ['active', 'trialing'])
    .limit(1)
    .maybeSingle()

  if (!activeSubscription && !brand.subscription_plan_override) {
    return NextResponse.json({
      error: 'Para crear tu primera campaña, primero debes activar un plan de SCENCE.',
      code: 'SUBSCRIPTION_REQUIRED',
    }, { status: 402 })
  }

  // ── Plan gating ───────────────────────────────────────────────────────────
  // Resolver plan efectivo: override manual → suscripción activa/trialing → organización.
  const orgPlan = await resolveBrandPlan(admin, brand.organization_id, brand.id)
  const limits  = getPlanLimits(orgPlan)

  let body: {
    name: string
    type: string
    visibility: 'private' | 'open'
    description?: string
    start_date?: string
    end_date?: string
    budget_total?: number
    application_deadline?: string
    max_influencers?: number
    content_guidelines?: string
    hashtags?: string[]
    platforms?: string[]
    address?: string
    deliverable_templates?: DeliverableTemplateInput[]
    application_questions?: string[]
    campaign_benefits?: unknown[]
  }

  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { name, type, visibility, description, start_date, end_date,
          budget_total, application_deadline, max_influencers,
          content_guidelines, hashtags, platforms, address, deliverable_templates,
          application_questions } = body
  const campaignBenefits = normalizeCampaignBenefits(body.campaign_benefits)

  if (!name?.trim()) return NextResponse.json({ error: 'El nombre es requerido' }, { status: 422 })
  if (!type) return NextResponse.json({ error: 'El tipo es requerido' }, { status: 422 })
  if (!['private', 'open'].includes(visibility)) {
    return NextResponse.json({ error: 'visibility debe ser private u open' }, { status: 422 })
  }

  // Primera campaña pública incluida en todos los planes.
  // Después de la primera, solo planes con marketplace/open campaigns pueden seguir creando públicas.
  const { count: openCampaignCount } = await admin
    .from('campaigns')
    .select('id', { count: 'exact', head: true })
    .eq('brand_id', brand.id)
    .eq('visibility', 'open')

  const canUseFirstPublicCampaign = (openCampaignCount ?? 0) === 0

  if (visibility === 'open' && !limits.can_create_open_campaigns && !canUseFirstPublicCampaign) {
    return NextResponse.json({
      error: visibilityLimitMessage(orgPlan),
      code:  PLAN_ERROR_CODES.VISIBILITY_LIMIT,
      plan:  orgPlan,
    }, { status: 403 })
  }

  const { data, error } = await admin
    .from('campaigns')
    .insert({
      organization_id:      brand.organization_id,
      brand_id:             brand.id,
      created_by_brand_id:  brand.id,
      created_by:           user.id,
      name:                 name.trim(),
      type,
      visibility,
      status:               'draft',
      description:          description ?? null,
      start_date:           start_date ?? null,
      end_date:             end_date ?? null,
      budget_total:         budget_total ?? null,
      application_deadline: visibility === 'open' ? (application_deadline ?? null) : null,
      max_influencers:      visibility === 'open' ? (max_influencers ?? null) : null,
      // Preguntas obligatorias (pública: para postular / privada: para aceptar
      // la invitación) — opcionales en cualquier visibilidad. Se filtran
      // vacías/blancas.
      application_questions: (application_questions ?? []).map(q => String(q ?? '').trim()).filter(Boolean),
      content_guidelines:   content_guidelines ?? null,
      hashtags:             hashtags ?? [],
      platforms:            platforms ?? [],
      metadata: {
        address: (address && String(address).trim()) ? String(address).trim() : null,
      },
      currency:             'CLP',
      campaign_benefits:    campaignBenefits,
    })
    .select('id, name, status, visibility')
    .single()

  if (error) {
    console.error('[POST /api/brand-campaigns]', error)
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
