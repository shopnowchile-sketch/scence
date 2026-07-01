import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'

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

  let isCoBrand = false
  if (!isMainBrand && !isCreatorBrand) {
    const { data: coBrand } = await admin
      .from('campaign_brands')
      .select('campaign_id')
      .eq('campaign_id', campaignId)
      .eq('brand_id', brand.id)
      .maybeSingle()

    isCoBrand = !!coBrand
  }

  return {
    isBrand: true,
    canView: isMainBrand || isCreatorBrand || isCoBrand,
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

  let isCoBrand = false
  if (!isMain) {
    const { data: coBrand } = await admin
      .from('campaign_brands')
      .select('campaign_id')
      .eq('campaign_id', campaignId)
      .eq('brand_id', profileBrand.id)
      .maybeSingle()
    isCoBrand = !!coBrand
  }

  return {
    isBrand: true,
    canView: isMain || isCoBrand || isCreator,
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
  const { data, error } = await admin
    .from('campaigns')
    .select(`
      *,
      brand:brands!brand_id (id, name, logo_url, website, contact_name, contact_email),
      campaign_brands (
        id,
        brand:brands (id, name, logo_url, website, contact_name, contact_email)
      ),
      campaign_influencers (
        id, fee, status, notes, application_status, origin,
        influencer:influencers (
          id, display_name, avatar_url, city, country,
          influencer_social_profiles (platform, username, followers, engagement_rate)
        )
      ),
      campaign_deliverables (
        id, title, type, status, due_date, platform,
        published_at, published_url, content_url, submitted_at, review_notes, progress,
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

  if (user.user_metadata?.is_brand) {
    const access = await getBrandAccess(admin, user.id, params.id)
    if (!access.canView) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    return NextResponse.json({ data: { ...data, _brand_permissions: access } })
  }

  if (orgId && data.organization_id !== orgId) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  }

  return NextResponse.json({ data })
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
  const { id: _id, created_at: _ca, created_by: _cb, organization_id: _oi, budget_spent: _bs, ...rest } = body

  // Scope update to the user's own org
  let query = admin
    .from('campaigns')
    .update({ ...rest, updated_at: new Date().toISOString() })
    .eq('id', params.id)

  if (orgId) query = query.eq('organization_id', orgId)

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

  const { action, ...fields } = body

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
  }

  // Scope update to the user's own org
  let query = admin
    .from('campaigns')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', params.id)

  if (orgId) query = query.eq('organization_id', orgId)

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

  return NextResponse.json({ data })
}

// ── DELETE /api/campaigns/[id] ────────────────────────────────────────────────
export async function DELETE(_req: NextRequest, { params }: Params) {
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

  // Soft-delete: set status to canceled rather than hard delete
  // Scope to user's org for security
  let query = admin
    .from('campaigns')
    .update({ status: 'canceled', updated_at: new Date().toISOString() })
    .eq('id', params.id)

  if (orgId) query = query.eq('organization_id', orgId)

  const { error } = await query

  if (error) {
    console.error('[DELETE /api/campaigns/[id]]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
