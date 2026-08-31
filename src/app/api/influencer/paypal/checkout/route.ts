import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { getInfluencerPayPalToken, influencerPayPalBaseUrl } from '@/lib/influencer-paypal'
import { INFLUENCER_PRO_TERMS } from '@/lib/influencer-pro-terms'

export async function POST(request: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const { data: influencer } = await admin.from('influencers').select('id, organization_id, is_active').eq('user_id', user.id).maybeSingle()
  if (!influencer?.is_active) return NextResponse.json({ error: 'Tu cuenta de influencer no está activa.' }, { status: 403 })
  if (!influencer.organization_id) return NextResponse.json({ error: 'Tu cuenta no tiene una organización asociada.' }, { status: 409 })

  const { data: termsAcceptance } = await admin.from('influencer_terms_acceptances').select('id').eq('influencer_id', influencer.id).eq('document_key', INFLUENCER_PRO_TERMS.key).eq('document_version', INFLUENCER_PRO_TERMS.version).eq('status', 'accepted').maybeSingle()
  if (!termsAcceptance) return NextResponse.json({ error: 'Debes aceptar los Términos y Condiciones vigentes antes de continuar.' }, { status: 409 })

  const body = await request.json().catch(() => ({})) as { campaign_id?: string }
  if (body.campaign_id) {
    const { data: relationship } = await admin.from('campaign_influencers').select('id, campaigns!inner(status)').eq('campaign_id', body.campaign_id).eq('influencer_id', influencer.id).eq('application_status', 'accepted').maybeSingle()
    const campaign = relationship?.campaigns as unknown as { status?: string } | null
    if (!relationship || campaign?.status !== 'active') return NextResponse.json({ error: 'La campaña no está disponible para activar Pro.' }, { status: 422 })
  }

  const paypalPlanId = process.env.PAYPAL_INFLUENCER_PRO_PLAN_ID
  if (!paypalPlanId) return NextResponse.json({ error: 'PayPal todavía no está configurado para Influencer Pro.' }, { status: 503 })
  const accessToken = await getInfluencerPayPalToken()
  if (!accessToken) return NextResponse.json({ error: 'PayPal no está configurado.' }, { status: 503 })
  const appUrl = process.env.VERCEL_ENV === 'preview' ? request.nextUrl.origin : (process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin)
  const customId = `influencer:${influencer.id}${body.campaign_id ? `:${body.campaign_id}` : ''}`
  const response = await fetch(`${influencerPayPalBaseUrl()}/v1/billing/subscriptions`, {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': `scence-influencer-${influencer.id}-${Date.now()}` },
    body: JSON.stringify({ plan_id: paypalPlanId, custom_id: customId, application_context: { brand_name: 'SCENCE', user_action: 'SUBSCRIBE_NOW', return_url: `${appUrl}/inf-profile?tab=plan&checkout=processing`, cancel_url: `${appUrl}/inf-profile?tab=plan&checkout=cancelled` } }),
  })
  const result = await response.json().catch(() => null)
  if (!response.ok) return NextResponse.json({ error: result?.message ?? 'No se pudo iniciar la suscripción con PayPal.' }, { status: 502 })
  const url = result?.links?.find((link: { rel?: string; href?: string }) => link.rel === 'approve')?.href
  if (!url) return NextResponse.json({ error: 'PayPal no devolvió una URL de aprobación.' }, { status: 502 })
  return NextResponse.json({ url, subscription_id: result.id })
}
