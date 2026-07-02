import { NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'

// GET /api/influencer/campaigns
// Returns campaigns this influencer is assigned to.
export async function GET() {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: influencer } = await admin
    .from('influencers')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!influencer) return NextResponse.json({ error: 'Not an influencer account' }, { status: 403 })

  const { data, error } = await admin
    .from('campaign_influencers')
    .select(`
      id, status, application_status, fee, currency,
      campaign:campaigns (
        id, name, status, description, start_date, end_date,
        budget_total, currency,
        brand:brands!brand_id (id, name, logo_url)
      ),
      campaign_deliverables (
        id, title, type, status, due_date, platform, content_url, submitted_at
      )
    `)
    .eq('influencer_id', influencer.id)
    
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[GET /api/influencer/campaigns]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Filter out canceled campaigns in JS (safer than PostgREST joined filters)
  const filtered = (data ?? []).filter(ci => (ci.campaign as unknown as {status:string}|null)?.status !== 'canceled')

  return NextResponse.json({ data: filtered })
}
