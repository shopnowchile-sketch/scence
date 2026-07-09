import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import {
  resolveBrandPlan,
  getPlanLimits,
  campaignLimitMessage,
  visibilityLimitMessage,
  PLAN_ERROR_CODES,
} from '@/lib/plan-limits'
import { isDeliverableComplete } from '@/lib/deliverable-status'

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

  // Resolver brand_id desde user_id
  const { data: brand } = await admin
    .from('brands')
    .select('id, name, organization_id')
    .eq('user_id', user.id)
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
        id, title, type, status, due_date, platform,
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
  type Row = { campaign_influencers?: unknown[]; campaign_deliverables?: Array<{ status: string }> }
  const enriched = (data ?? []).map(c => {
    const row = c as Row
    const deliverables = row.campaign_deliverables ?? []
    return {
      ...c,
      influencer_count:  row.campaign_influencers?.length ?? 0,
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

  const { data: brand } = await admin
    .from('brands')
    .select('id, organization_id, status')
    .eq('user_id', user.id)
    .single()

  if (!brand) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })
  if (brand.status !== 'approved') {
    return NextResponse.json(
      { error: 'Tu marca está pendiente de aprobación. Aún no puedes crear campañas.' },
      { status: 403 }
    )
  }

  // ── Plan gating ───────────────────────────────────────────────────────────
  // Resolver plan efectivo: subscriptions activa/trialing → fallback organizations.subscription_plan
  const orgPlan = await resolveBrandPlan(admin, brand.organization_id)
  const limits  = getPlanLimits(orgPlan)

  // Contar campañas activas (draft, active, pending_approval, paused — todo excepto completed/canceled)
  const { count: activeCampaignCount } = await admin
    .from('campaigns')
    .select('id', { count: 'exact', head: true })
    .eq('brand_id', brand.id)
    .not('status', 'in', '("completed","canceled")')

  if ((activeCampaignCount ?? 0) >= limits.max_active_campaigns) {
    return NextResponse.json({
      error: campaignLimitMessage(orgPlan),
      code:  PLAN_ERROR_CODES.CAMPAIGN_LIMIT,
      plan:  orgPlan,
    }, { status: 403 })
  }

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
    deliverable_templates?: Array<{ type: string; quantity: number; description?: string; due_date?: string }>
  }

  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { name, type, visibility, description, start_date, end_date,
          budget_total, application_deadline, max_influencers,
          content_guidelines, hashtags, platforms, deliverable_templates } = body

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
      content_guidelines:   content_guidelines ?? null,
      hashtags:             hashtags ?? [],
      platforms:            platforms ?? [],
      currency:             'CLP',
    })
    .select('id, name, status, visibility')
    .single()

  if (error) {
    console.error('[POST /api/brand-campaigns]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Crear deliverables si se especificaron templates
  if (deliverable_templates && deliverable_templates.length > 0) {
    const deliverables = deliverable_templates.flatMap(t =>
      Array.from({ length: t.quantity }).map(() => ({
        campaign_id:  data.id,
        type:         t.type,
        title:        t.description || t.type,
        platform:     null,
        due_date:     t.due_date || null,
        status:       'pending',
      }))
    )
    const { error: delError } = await admin.from('campaign_deliverables').insert(deliverables)
    if (delError) console.error('[POST /api/brand-campaigns] deliverables insert:', delError.message)
  }

  return NextResponse.json({ data }, { status: 201 })
}
