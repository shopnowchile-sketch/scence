import { NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: influencer } = await admin.from('influencers').select('id, organization_id, influencer_social_profiles(platform, username, is_primary)').eq('user_id', user.id).maybeSingle()
  if (!influencer) return NextResponse.json({ error: 'Not an influencer account' }, { status: 403 })

  const profiles = influencer.influencer_social_profiles ?? []
  const primary = profiles.find(profile => profile.is_primary) ?? profiles.find(profile => profile.platform === 'instagram') ?? profiles[0]
  const username = primary?.username?.replace(/^@/, '') ?? ''
  if (!username) return NextResponse.json({ error: 'Agrega tu Instagram para crear tu link.' }, { status: 422 })

  const { data: existing } = await admin.from('affiliate_links').select('id, code, full_link, clicks, conversions, revenue, currency, is_active').eq('influencer_id', influencer.id).is('campaign_id', null).eq('name', 'Recomienda SCENCE').maybeSingle()
  if (existing) return NextResponse.json({ data: existing })

  let code = ''
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = crypto.randomUUID().replaceAll('-', '').slice(0, 10)
    const { data: collision } = await admin.from('affiliate_links').select('id').eq('code', candidate).maybeSingle()
    if (!collision) { code = candidate; break }
  }
  if (!code) return NextResponse.json({ error: 'No se pudo crear el link.' }, { status: 500 })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const { data, error } = await admin.from('affiliate_links').insert({
    organization_id: influencer.organization_id,
    influencer_id: influencer.id,
    campaign_id: null,
    name: 'Recomienda SCENCE',
    code,
    redirect_url: `${appUrl}/register/brand?ref=${encodeURIComponent(username)}`,
    full_link: `${appUrl}/track/${code}`,
    clicks: 0,
    conversions: 0,
    revenue: 0,
    commission_rate: 0,
    currency: 'CLP',
    is_active: true,
  }).select('id, code, full_link, clicks, conversions, revenue, currency, is_active').single()
  if (error) return NextResponse.json({ error: 'No se pudo crear el link de afiliado.' }, { status: 500 })
  return NextResponse.json({ data })
}
