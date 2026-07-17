import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { getOrgId, provisionOrgForBrand, resolveBrandAccess } from '@/lib/supabase/ensureOrg'
import { hasBrandPlanAccess, resolveBrandPlan } from '@/lib/plan-limits'

export async function GET(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)

  if (!orgId) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 400 })
  }

  const search = req.nextUrl.searchParams.get('search')?.trim().toLowerCase() ?? ''

  const { data: campaigns, error: campaignsError } = await admin
    .from('campaigns')
    .select('id, name')
    .eq('organization_id', orgId)

  if (campaignsError) {
    return NextResponse.json({ error: campaignsError.message }, { status: 500 })
  }

  const campaignIds = (campaigns ?? []).map(c => c.id)

  const collaboratorRows = campaignIds.length
    ? await admin
        .from('campaign_brands')
        .select(`
          brand_id,
          role,
          campaign_id,
          brand:brands(
            id,
            name,
            logo_url,
            industry,
            status,
            created_at,
            created_by
          )
        `)
        .in('campaign_id', campaignIds)
    : { data: [], error: null }

  if (collaboratorRows.error) {
    return NextResponse.json({ error: collaboratorRows.error.message }, { status: 500 })
  }

  const { data: createdBrands, error: createdError } = await admin
    .from('brands')
    .select('id, name, logo_url, industry, status, created_at, created_by')
    .eq('created_by', user.id)

  if (createdError) {
    return NextResponse.json({ error: createdError.message }, { status: 500 })
  }

  const campaignMap = new Map((campaigns ?? []).map(c => [c.id, c.name]))
  const brandMap = new Map<string, Record<string, unknown>>()

  for (const brand of createdBrands ?? []) {
    brandMap.set(brand.id, {
      ...brand,
      relationship: 'Creada por ti',
      campaigns: [],
    })
  }

  for (const row of collaboratorRows.data ?? []) {
    const brand = Array.isArray(row.brand) ? row.brand[0] : row.brand
    if (!brand) continue

    const current = brandMap.get(brand.id) ?? {
      ...brand,
      relationship: 'Colaboradora',
      campaigns: [],
    }

    const campaignList = Array.isArray(current.campaigns)
      ? current.campaigns
      : []

    const campaignName = campaignMap.get(row.campaign_id)

    if (campaignName && !campaignList.includes(campaignName)) {
      campaignList.push(campaignName)
    }

    brandMap.set(brand.id, {
      ...current,
      campaigns: campaignList,
    })
  }

  let rows = Array.from(brandMap.values())

  if (search) {
    rows = rows.filter(row =>
      String(row.name ?? '').toLowerCase().includes(search)
    )
  }

  rows.sort((a, b) =>
    String(a.name ?? '').localeCompare(String(b.name ?? ''), 'es')
  )

  return NextResponse.json({
    data: rows,
    total: rows.length,
  })
}


export async function POST(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)

  if (!orgId) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 400 })
  }

  const access = await resolveBrandAccess(user.id)
  if (!access) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })

  const plan = await resolveBrandPlan(admin, orgId, access.brandId)
  if (!hasBrandPlanAccess(plan)) {
    return NextResponse.json(
      { error: 'Debes elegir y activar un plan para crear marcas colaboradoras.', code: 'PLAN_REQUIRED' },
      { status: 402 },
    )
  }

  let body: Record<string, unknown>

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const name = String(body.name ?? '').trim()
  const email = String(body.contact_email ?? '').trim().toLowerCase()

  if (!name) {
    return NextResponse.json({ error: 'El nombre es obligatorio' }, { status: 422 })
  }

  if (!email) {
    return NextResponse.json(
      { error: 'El email de contacto es obligatorio' },
      { status: 422 }
    )
  }

  const { data: existingBrand, error: existingError } = await admin
    .from('brands')
    .select('id, name, status')
    .ilike('contact_email', email)
    .maybeSingle()

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 })
  }

  if (existingBrand) {
    return NextResponse.json(
      {
        error: `Ya existe una marca registrada con ese email: ${existingBrand.name}`,
        existing_brand_id: existingBrand.id,
      },
      { status: 409 }
    )
  }

  const newOrgId = await provisionOrgForBrand(name)

  if (!newOrgId) {
    return NextResponse.json(
      { error: 'No se pudo crear la organización de la marca' },
      { status: 500 }
    )
  }

  const { data, error } = await admin
    .from('brands')
    .insert({
      organization_id: newOrgId,
      name,
      logo_url: body.logo_url || null,
      website: body.website || null,
      industry: body.industry || null,
      contact_name: body.contact_name || null,
      contact_email: email,
      contact_phone: body.contact_phone || null,
      notes: body.notes || null,
      created_by: user.id,
      metadata: {
        created_from_brand_portal: true,
        invited_by_organization_id: orgId,
      },
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data }, { status: 201 })
}
