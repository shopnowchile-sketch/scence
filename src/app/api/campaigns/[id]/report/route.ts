import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

type Params = { params: { id: string } }

// ── GET /api/campaigns/[id]/report ───────────────────────────────────────────
// Returns full campaign data for PDF report generation (no auth check —
// accessed from report page which is behind the dashboard layout auth)
export async function GET(_req: NextRequest, { params }: Params) {
  const admin = createAdminClient()

  const { data: campaign, error } = await admin
    .from('campaigns')
    .select(`
      *,
      brand:brands!brand_id (
        id, name, logo_url, website, contact_name, contact_email, contact_phone
      ),
      campaign_influencers (
        id, fee, status, notes,
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
    console.error('[GET /api/campaigns/[id]/report]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data: campaign })
}
