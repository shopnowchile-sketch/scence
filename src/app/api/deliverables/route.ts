import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'

/**
 * GET /api/deliverables
 * Retorna todos los campaign_deliverables de la org con due_date, para mostrar en calendario.
 * Query params: from, to (ISO dates)
 */
export async function GET(request: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return NextResponse.json({ error: 'Organization not found' }, { status: 400 })

  const sp   = request.nextUrl.searchParams
  const from = sp.get('from')
  const to   = sp.get('to')

  let query = admin
    .from('campaign_deliverables')
    .select(`
      id, title, type, platform, status, due_date, content_url,
      campaign_id,
      influencer:influencers (id, display_name, avatar_url)
    `)
    .not('due_date', 'is', null)
    .order('due_date', { ascending: true })

  if (from) query = query.gte('due_date', from)
  if (to)   query = query.lte('due_date', to)

  const { data, error } = await query

  if (error) {
    console.error('[GET /api/deliverables]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Fetch campaign names + filter by org in a second query
  const campaignIds = Array.from(new Set((data ?? []).map(d => d.campaign_id).filter(Boolean))) as string[]
  const campMap: Record<string, { name: string; organization_id: string }> = {}
  if (campaignIds.length > 0) {
    const { data: camps } = await admin
      .from('campaigns')
      .select('id, name, organization_id')
      .in('id', campaignIds)
    for (const c of camps ?? []) campMap[c.id] = c
  }

  const filtered = (data ?? [])
    .filter(d => campMap[d.campaign_id]?.organization_id === orgId)
    .map(d => ({ ...d, campaign: campMap[d.campaign_id] ? { id: d.campaign_id, name: campMap[d.campaign_id].name } : null }))

  return NextResponse.json({ data: filtered })
}
