import { createAdminClient } from '@/lib/supabase/server'
import { getResend, FROM_EMAIL, campaignOpenAvailableEmail } from '@/lib/resend'

const BATCH_SIZE = 100 // límite de resend.batch.send()
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'

/**
 * notifyAllInfluencersOfOpenCampaign — al activar una campaña pública
 * (visibility='open'), avisa por email a TODAS las influencers elegibles
 * del sistema (no solo top-50 por seguidores, y sin filtrar por
 * organization_id — las marcas quedan con organization_id propia y aislada,
 * ver fix 2026-07-02 en /api/campaigns, así que filtrar por org dejaría a
 * casi todas las influencers sin avisar).
 *
 * Reutiliza el mismo template (campaignOpenAvailableEmail) y la misma tabla
 * de idempotencia (campaign_influencer_notifications) que el botón manual
 * en /api/campaigns/[id]/notify-influencers — por eso si alguien ya fue
 * notificada (por el botón manual o por un envío automático previo), no se
 * le vuelve a escribir.
 *
 * No lanza excepción: un fallo de email nunca debe bloquear la activación
 * de la campaña.
 */
export async function notifyAllInfluencersOfOpenCampaign(
  campaignId: string,
  admin: ReturnType<typeof createAdminClient>
): Promise<{ sent: number; failed: number; skipped?: string }> {
  try {
    const { data: campaign } = await admin
      .from('campaigns')
      .select('id, name, type, visibility')
      .eq('id', campaignId)
      .maybeSingle()

    if (!campaign || campaign.visibility !== 'open') {
      return { sent: 0, failed: 0, skipped: 'not_open' }
    }

    const [{ data: existingRows }, { data: notifiedRows }] = await Promise.all([
      admin.from('campaign_influencers').select('influencer_id').eq('campaign_id', campaignId),
      admin.from('campaign_influencer_notifications').select('influencer_id').eq('campaign_id', campaignId),
    ])

    const excludeIds = new Set([
      ...(existingRows ?? []).map(r => r.influencer_id).filter(Boolean),
      ...(notifiedRows ?? []).map(r => r.influencer_id).filter(Boolean),
    ])

    const { data: candidates, error: infErr } = await admin
      .from('influencers')
      .select('id, display_name, email')
      .eq('is_active', true)
      .not('email', 'is', null)

    if (infErr || !candidates) {
      console.error('[notifyAllInfluencersOfOpenCampaign] error listando influencers', infErr)
      return { sent: 0, failed: 0, skipped: 'query_error' }
    }

    const eligible = candidates.filter(inf => !excludeIds.has(inf.id))
    if (eligible.length === 0) return { sent: 0, failed: 0 }

    let sent = 0
    let failed = 0

    for (let i = 0; i < eligible.length; i += BATCH_SIZE) {
      const chunk = eligible.slice(i, i + BATCH_SIZE)
      try {
        const { error: batchErr } = await getResend().batch.send(
          chunk.map(inf => ({
            from: FROM_EMAIL,
            to: inf.email as string,
            subject: `Nueva campaña abierta: ${campaign.name}`,
            html: campaignOpenAvailableEmail({
              influencerName: inf.display_name ?? 'influencer',
              campaignName: campaign.name,
              campaignType: campaign.type,
              applyUrl: `${APP_URL}/inf-campaign/${campaign.id}`,
            }),
          }))
        )
        if (batchErr) throw new Error(batchErr.message ?? 'Resend batch error')

        await admin
          .from('campaign_influencer_notifications')
          .upsert(
            chunk.map(inf => ({ campaign_id: campaignId, influencer_id: inf.id })),
            { onConflict: 'campaign_id,influencer_id' }
          )
        sent += chunk.length
      } catch (e) {
        console.error('[notifyAllInfluencersOfOpenCampaign] error en batch', e)
        failed += chunk.length
      }
    }

    return { sent, failed }
  } catch (e) {
    console.error('[notifyAllInfluencersOfOpenCampaign] fallo no bloqueante', e)
    return { sent: 0, failed: 0, skipped: 'exception' }
  }
}
