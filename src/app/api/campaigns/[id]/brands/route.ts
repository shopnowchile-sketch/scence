import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'

type Params = { params: { id: string } }

export async function POST(req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)

  let body: { brand_id?: string; role?: string } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.brand_id) {
    return NextResponse.json({ error: 'brand_id requerido' }, { status: 422 })
  }

  const { data: campaign, error: campaignError } = await admin
    .from('campaigns')
    .select('id, organization_id, brand_id')
    .eq('id', params.id)
    .maybeSingle()

  if (campaignError) {
    return NextResponse.json({ error: campaignError.message }, { status: 500 })
  }

  if (!campaign || (orgId && campaign.organization_id !== orgId)) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  }

  if (campaign.brand_id === body.brand_id) {
    return NextResponse.json({ error: 'Esta marca ya es la marca principal' }, { status: 409 })
  }

  const { data, error } = await admin
    .from('campaign_brands')
    .upsert({
      campaign_id: params.id,
      brand_id: body.brand_id,
      role: body.role || 'collaborator',
      assigned_by: user.id,
    }, { onConflict: 'campaign_id,brand_id' })
    .select('id, campaign_id, brand_id, role, brand:brands(id, name, logo_url, website, organization_id)')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data })
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  const brandId = new URL(req.url).searchParams.get('brand_id')

  if (!brandId) {
    return NextResponse.json({ error: 'brand_id requerido' }, { status: 422 })
  }

  const { data: campaign } = await admin
    .from('campaigns')
    .select('id, organization_id, brand_id')
    .eq('id', params.id)
    .maybeSingle()

  if (!campaign || (orgId && campaign.organization_id !== orgId)) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  }

  if (campaign.brand_id === brandId) {
    return NextResponse.json({ error: 'No se puede quitar la marca principal desde colaboradoras' }, { status: 409 })
  }

  const { error } = await admin
    .from('campaign_brands')
    .delete()
    .eq('campaign_id', params.id)
    .eq('brand_id', brandId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
