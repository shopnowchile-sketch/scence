import { NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { hasActiveCampaignCommitment } from '@/lib/influencer-pro-commitment'
import { scheduleInfluencerPayPalCancellation } from '@/lib/influencer-paypal'

export async function POST() {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const { data: influencer } = await admin.from('influencers').select('id, is_active').eq('user_id', user.id).maybeSingle()
  if (!influencer) return NextResponse.json({ error: 'Not an influencer account' }, { status: 403 })
  const { data: subscriptions } = await admin.from('subscriptions').select('id, paypal_subscription_id, metadata').eq('metadata->>influencer_id', influencer.id).in('status', ['active', 'trialing']).order('created_at', { ascending: false }).limit(1)
  const subscription = subscriptions?.[0]
  if (subscription) {
    const commitment = await hasActiveCampaignCommitment(admin, influencer.id, subscription.metadata)
    if (commitment.blocked) return NextResponse.json({ error: 'Tu cuenta está comprometida con una campaña activa o con entregables pendientes y no puede desactivarse todavía.' }, { status: 409 })
    if (subscription.paypal_subscription_id) {
      try {
        await scheduleInfluencerPayPalCancellation(subscription.paypal_subscription_id)
      } catch (error) {
        console.error('[POST /api/influencer/account/deactivate] schedule Pro cancellation:', error)
        return NextResponse.json({ error: 'No se pudo programar la cancelación al final del período.' }, { status: 502 })
      }
      await admin.from('subscriptions').update({
        updated_at: new Date().toISOString(),
        metadata: {
          ...(subscription.metadata ?? {}),
          cancel_at_period_end: true,
          scheduled_cancel_reason: 'influencer_deactivated',
        },
      }).eq('id', subscription.id)
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
