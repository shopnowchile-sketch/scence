import { NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { hasActiveCampaignCommitment } from '@/lib/influencer-pro-commitment'
import { cancelInfluencerPayPalAtPeriodEnd, persistInfluencerProCancellation } from '@/lib/influencer-paypal'

export async function POST() {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const { data: influencer } = await admin.from('influencers').select('id, is_active').eq('user_id', user.id).maybeSingle()
  if (!influencer) return NextResponse.json({ error: 'Not an influencer account' }, { status: 403 })
  const { data: subscriptions } = await admin.from('subscriptions').select('id, current_period_end, paypal_subscription_id, metadata').eq('metadata->>influencer_id', influencer.id).in('status', ['active', 'trialing']).order('created_at', { ascending: false }).limit(1)
  const subscription = subscriptions?.[0]
  if (subscription) {
    const commitment = await hasActiveCampaignCommitment(admin, influencer.id, subscription.metadata)
    if (commitment.blocked) return NextResponse.json({ error: 'Tu cuenta está comprometida con una campaña activa o con entregables pendientes y no puede desactivarse todavía.' }, { status: 409 })
    if (subscription.paypal_subscription_id) {
      let paidThrough: string
      try {
        ({ paidThrough } = await cancelInfluencerPayPalAtPeriodEnd(subscription.paypal_subscription_id))
      } catch (error) {
        console.error('[POST /api/influencer/account/deactivate] cancel Pro renewal:', error)
        return NextResponse.json({ error: 'No se pudo cancelar la renovación de tu Plan Pro en PayPal. Tu cuenta no fue desactivada.' }, { status: 502 })
      }
      const { error: persistError } = await persistInfluencerProCancellation(admin, subscription, paidThrough, 'influencer_deactivated')
      if (persistError) {
        console.error('[POST /api/influencer/account/deactivate] persist Pro cancellation:', persistError)
        return NextResponse.json({ error: 'PayPal canceló la renovación, pero no se pudo sincronizar SCENCE. Tu cuenta no fue desactivada.' }, { status: 500 })
      }
    }
  }
  const { error: profileError } = await admin.from('influencers').update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', influencer.id)
  if (profileError) return NextResponse.json({ error: 'No se pudo desactivar la cuenta.' }, { status: 500 })
  const { error: banError } = await admin.auth.admin.updateUserById(user.id, { ban_duration: '876000h' })
  if (banError) {
    await admin.from('influencers').update({ is_active: true }).eq('id', influencer.id)
    return NextResponse.json({ error: 'No se pudo bloquear el acceso de la cuenta.' }, { status: 500 })
  }
  await supabase.auth.signOut()
  return NextResponse.json({ deactivated: true })
}
