import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'

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
