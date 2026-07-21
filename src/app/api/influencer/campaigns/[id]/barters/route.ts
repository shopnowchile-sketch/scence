import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'

type Params = { params: { id: string } }

// GET /api/influencer/campaigns/[id]/barters — solo lectura, scoped al influencer
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: influencer } = await admin
    .from('influencers')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!influencer) return NextResponse.json({ error: 'Not an influencer' }, { status: 403 })

  const { data, error } = await admin
    .from('barters')
    .select(`
      id, item, description, estimated_value, currency, status, simple_status, benefit_tracking, evidence_url,
      agreed_date, completed_at, cancelled_at, cancellation_reason, created_at, updated_at,
      benefits:barter_benefits (
        id, benefit_type, description, fixed_value, currency,
        commission_rate, affiliate_link_id, position
      ),
      influencer:influencers (id, display_name, avatar_url),
      history:barter_status_history (id, barter_id, from_status, to_status, note, created_at)
    `)
    .eq('campaign_id', params.id)
    .eq('influencer_id', influencer.id)   // seguridad: solo sus propios canjes
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[GET /api/influencer/campaigns/[id]/barters]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const { data: campaign } = await admin
    .from('campaigns')
    .select('campaign_benefits')
    .eq('id', params.id)
    .maybeSingle()

  const normalized = (data ?? []).map((b: any) => ({
    ...b,
    campaign_benefits: campaign?.campaign_benefits ?? [],
    history: [...(b.history ?? [])].sort((a: any, z: any) => (a.created_at < z.created_at ? -1 : 1)),
  }))

  return NextResponse.json({ data: normalized })
}
