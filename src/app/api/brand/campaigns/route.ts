import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
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

  const orFilter = `brand_id.eq.${brand.id},created_by_brand_id.eq.${brand.id}`

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
    social_tags?: string[]
    platforms?: string[]
    address?: string
    brief_url?: string
    metadata?: Record<string, unknown>
    deliverable_templates?: DeliverableTemplateInput[]
    application_questions?: string[]
    campaign_benefits?: unknown[]
  }

  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { name, type, visibility, description, start_date, end_date,
          budget_total, application_deadline, max_influencers,
          content_guidelines, hashtags, social_tags, platforms, address, brief_url, metadata, deliverable_templates,
          application_questions } = body
  const campaignBenefits = normalizeCampaignBenefits(body.campaign_benefits)

  if (!name?.trim()) return NextResponse.json({ error: 'El nombre es requerido' }, { status: 422 })
  if (!type) return NextResponse.json({ error: 'El tipo es requerido' }, { status: 422 })
  if (!['private', 'open'].includes(visibility)) {
    return NextResponse.json({ error: 'visibility debe ser private u open' }, { status: 422 })
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
      mention_handles:      (social_tags ?? []).map(tag => String(tag).trim()).filter(Boolean),
      platforms:            platforms ?? [],
      brief_url:            brief_url ?? null,
      // El wizard crea un borrador antes de llegar al último paso. Persistir
      // las plantillas en ese primer POST mantiene Reel/Story/asistencia en la
      // misma fuente que usa Overview, las aprobaciones y las deliverables.
      deliverable_templates: Array.isArray(deliverable_templates) ? deliverable_templates : [],
      metadata: {
        ...(metadata ?? {}),
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
