import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'

// ── GET /api/campaigns ────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  // Authenticate via regular client (respects cookies/session)
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const status   = searchParams.get('status')
  const type     = searchParams.get('type')
  const platform = searchParams.get('platform')
  const search   = searchParams.get('search')
  const page     = parseInt(searchParams.get('page') ?? '1', 10)
  const limit    = parseInt(searchParams.get('limit') ?? '50', 10)

  // Use admin client to bypass RLS — we apply our own filtering below
  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)

  let query = admin
    .from('campaigns')
    .select('*, brand:brands!brand_id(id, name, logo_url)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1)

  // Scope: by org if available, otherwise by creator
  if (orgId) {
    query = query.eq('organization_id', orgId)
  } else {
    query = query.eq('created_by', user.id)
  }

  if (status)   query = query.eq('status', status)
  if (type)     query = query.eq('type', type)
  if (platform) query = query.contains('platforms', [platform])
  if (search)   query = query.ilike('name', `%${search}%`)

  const { data, error, count } = await query

  if (error) {
    console.error('[GET /api/campaigns]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const campaignIds = (data ?? []).map(c => c.id)

  // Batch-fetch influencer counts and deliverable counts for this page
  const [{ data: ciRows }, { data: cdRows }] = await Promise.all([
    campaignIds.length
      ? admin.from('campaign_influencers').select('campaign_id').in('campaign_id', campaignIds)
      : { data: [] },
    campaignIds.length
      ? admin.from('campaign_deliverables').select('campaign_id, status').in('campaign_id', campaignIds)
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
    if (r.status === 'published' || r.status === 'approved') {
      delDone[r.campaign_id] = (delDone[r.campaign_id] ?? 0) + 1
    }
  }

  const enriched = (data ?? []).map(c => ({
    ...c,
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
    organization_id,
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
      deliverable_templates: Array.isArray(deliverable_templates) && (deliverable_templates as unknown[]).length > 0
        ? deliverable_templates
        : [],
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
