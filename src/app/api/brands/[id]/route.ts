import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'

type Params = { params: { id: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: brand, error: brandError } = await admin
    .from('brands')
    .select('*')
    .eq('id', params.id)
    .single()

  if (brandError) {
    if (brandError.code === 'PGRST116') return NextResponse.json({ error: 'Brand not found' }, { status: 404 })
    return NextResponse.json({ error: brandError.message }, { status: 500 })
  }

  const { data: primaryCampaigns } = await admin
    .from('campaigns')
    .select('id, name, status, budget_total, currency, created_at')
    .eq('brand_id', params.id)
    .order('created_at', { ascending: false })

  const { data: coBrandRows } = await admin
    .from('campaign_brands')
    .select('campaigns(id, name, status, budget_total, currency, created_at)')
    .eq('brand_id', params.id)

  const campaigns = [
    ...(primaryCampaigns ?? []),
    ...((coBrandRows ?? []).map((r: any) => r.campaigns).filter(Boolean)),
  ]

  const uniqueCampaigns = Array.from(new Map(campaigns.map((c: any) => [c.id, c])).values())

  return NextResponse.json({ data: { ...brand, campaigns: uniqueCampaigns } })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { id: _id, organization_id: _oi, created_by: _cb, created_at: _ca, ...rest } = body

  const { data, error } = await admin
    .from('brands')
    .update({ ...rest, updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { error } = await admin
    .from('brands')
    .delete()
    .eq('id', params.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
