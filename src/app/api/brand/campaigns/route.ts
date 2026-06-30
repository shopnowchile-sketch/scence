import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'

// GET /api/brand-campaigns — campañas de la marca autenticada
export async function GET() {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!user.user_metadata?.is_brand) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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

  const { data, error } = await admin
    .from('campaigns')
    .select(`
      id, name, description, type, status, visibility, application_deadline,
      max_influencers, start_date, end_date,
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

  if (error) {
    console.error('[GET /api/brand-campaigns]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data: data ?? [], brand })
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
