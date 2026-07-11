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
      id, status, application_status, origin, fee, currency,
      campaign:campaigns (
        id, name, status, type, description, start_date, end_date,
        budget_total, currency, deliverable_templates,
        brand:brands!brand_id (id, name, logo_url)
      ),
      campaign_deliverables (
        id, title, type, status, due_date, platform, content_url, published_url, submitted_at
      )
    `)
    .eq('influencer_id', influencer.id)
    
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[GET /api/influencer/campaigns]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Filter out canceled campaigns AND draft/pending_approval (preasignación no
  // activada: la influencer no debe ver esas campañas ni sus deliverables).
  const HIDDEN = new Set(['canceled', 'draft', 'pending_approval'])
  const filtered = (data ?? []).filter(ci =>
    !HIDDEN.has(String((ci.campaign as unknown as { status?: string } | null)?.status ?? ''))
  )

  return NextResponse.json({ data: filtered })
}
