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
    .select('id, organization_id')
    .eq('user_id', user.id)
    .single()

  if (!influencer) return NextResponse.json({ error: 'Not an influencer' }, { status: 403 })

  // Autoreparación: cada influencer aceptada debe tener su fila de canje.
  // Si una carga masiva anterior quedó incompleta, la creamos al abrir la
  // campaña. No depende de que exista una marca asignada.
  const { data: membership } = await admin
    .from('campaign_influencers')
    .select('id')
    .eq('campaign_id', params.id)
    .eq('influencer_id', influencer.id)
    .eq('application_status', 'accepted')
    .maybeSingle()

  if (membership) {
    const { data: current } = await admin
      .from('barters')
      .select('id')
      .eq('campaign_id', params.id)
      .eq('influencer_id', influencer.id)
      .maybeSingle()

    if (!current) {
      const { data: campaign } = await admin
        .from('campaigns')
        .select('organization_id, brand_id, currency, campaign_benefits')
        .eq('id', params.id)
        .maybeSingle()
      const totalValue = (Array.isArray(campaign?.campaign_benefits) ? campaign.campaign_benefits : [])
        .reduce((sum: number, benefit: any) => sum + (Number(benefit?.estimated_value) || 0), 0)

      if (campaign) {
        const { error: createError } = await admin.from('barters').insert({
          organization_id: campaign.organization_id,
          campaign_id: params.id,
          campaign_influencer_id: membership.id,
          influencer_id: influencer.id,
          brand_id: campaign.brand_id ?? null,
          item: 'Beneficios de campaña',
          estimated_value: totalValue || null,
          currency: campaign.currency ?? 'CLP',
          status: 'pactado',
          simple_status: 'pending',
        })
        if (createError) console.error('[influencer barters] auto-create failed', createError)
      }
    }
  }

  const { data, error } = await admin
    .from('barters')
    .select(`
      id, item, description, estimated_value, currency, status, simple_status, benefit_tracking, evidence_url,
      agreed_date, completed_at, cancelled_at, cancellation_reason, created_at, updated_at,
      benefits:barter_benefits (
        id, benefit_type, description, fixed_value, currency,
        commission_rate, affiliate_link_id, delivery_method, status, delivered_at,
        completed_at, status_note, position
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
