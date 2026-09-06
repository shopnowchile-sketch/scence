import { createAdminClient } from '@/lib/supabase/server'
import { getResend, FROM_EMAIL, campaignOpenAvailableEmail, influencerInviteEmail, campaignAssignedEmail, sponsorOpportunityEmail } from '@/lib/resend'

const BATCH_SIZE = 100 // límite de resend.batch.send()
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'

export async function notifyEligibleBrandsOfSponsorOpportunity(campaignId: string, admin: ReturnType<typeof createAdminClient>): Promise<{ sent: number; failed: number; skipped?: string }> {
  try {
    const { data: campaign } = await admin.from('campaigns').select('id,name,type,brand_id,metadata').eq('id', campaignId).eq('status', 'active').maybeSingle()
    const metadata = campaign?.metadata && typeof campaign.metadata === 'object' ? campaign.metadata as Record<string, unknown> : {}
    const config = metadata.collaboration_opportunity && typeof metadata.collaboration_opportunity === 'object' ? metadata.collaboration_opportunity as Record<string, unknown> : null
    if (!campaign || !config?.enabled) return { sent: 0, failed: 0, skipped: 'not_enabled' }
    const alreadyNotified = new Set(Array.isArray(metadata.sponsor_notified_brand_ids) ? metadata.sponsor_notified_brand_ids.map(String) : [])
    const { data: activeMemberships } = await admin.from('organization_members').select('organization_id').eq('is_active', true)
    const organizationIds = Array.from(new Set((activeMemberships ?? []).map(row => row.organization_id).filter(Boolean)))
    if (!organizationIds.length) return { sent: 0, failed: 0 }
    const { data: brands, error } = await admin.from('brands').select('id,name,contact_email,organization_id').in('organization_id', organizationIds).neq('id', campaign.brand_id).not('contact_email', 'is', null)
    if (error) throw error
    const targets = (brands ?? []).filter(brand => !alreadyNotified.has(brand.id))
    const successfulIds: string[] = []
    let failed = 0
    for (const brand of targets) {
      try {
        const { error: emailError } = await getResend().emails.send({ from: FROM_EMAIL, to: brand.contact_email as string, subject: `Nueva oportunidad sponsor: ${campaign.name}`, html: sponsorOpportunityEmail({ brandName: brand.name, campaignName: campaign.name, campaignType: campaign.type, benefits: typeof config.benefits === 'string' ? config.benefits : null, opportunityUrl: `${APP_URL}/brand-opportunities` }) })
        if (emailError) throw new Error(emailError.message)
        successfulIds.push(brand.id)
      } catch (sendError) { console.error('[notifyEligibleBrandsOfSponsorOpportunity] email', sendError); failed += 1 }
    }
    if (successfulIds.length) await admin.from('campaigns').update({ metadata: { ...metadata, sponsor_notified_brand_ids: [...Array.from(alreadyNotified), ...successfulIds], sponsor_notifications_sent_at: new Date().toISOString() } }).eq('id', campaignId)
    return { sent: successfulIds.length, failed }
  } catch (error) { console.error('[notifyEligibleBrandsOfSponsorOpportunity]', error); return { sent: 0, failed: 0, skipped: 'exception' } }
}

/**
 * resolvePendingCampaignAnnouncement — FUENTE ÚNICA de "a quién le falta el
 * aviso de esta campaña". La usan los tres puntos de entrada (envío automático
 * al activar, botón manual y el contador que muestra el detalle), para que
 * ninguno pueda quedar con un criterio distinto al de los otros.
 *
 * FIX (2026-09-06, causa raíz de "la activé y no llegó ningún correo"): el
 * criterio era `visibility === 'open'`, así que una campaña PRIVADA activa no
 * avisaba a nadie — ni por activación ni por el botón, que respondía 422. Pero
 * `private` no significa oculta (invariante 16.3): significa "requiere Plan Pro
 * para postular" y es visible para TODAS en el marketplace. Anunciarla es
 * consistente con esa regla y es la conversión natural a Plan Pro. La campaña
 * debe estar ACTIVA: una en borrador no se anuncia.
 */
export async function resolvePendingCampaignAnnouncement(
  campaignId: string,
  admin: ReturnType<typeof createAdminClient>
) {
  const { data: campaign } = await admin
    .from('campaigns')
    .select('id, name, type, visibility, status')
    .eq('id', campaignId)
    .maybeSingle()

  if (!campaign) return { campaign: null, pending: [], skipped: 'not_found' as const }
  if (campaign.status !== 'active') return { campaign, pending: [], skipped: 'not_active' as const }
  if (campaign.visibility !== 'open' && campaign.visibility !== 'private') {
    return { campaign, pending: [], skipped: 'not_announceable' as const }
  }

  // Ya asignadas/postuladas, o ya notificadas antes: la tabla de idempotencia
  // es lo que impide que reactivar una campaña reenvíe el correo.
  const [{ data: existingRows }, { data: notifiedRows }] = await Promise.all([
    admin.from('campaign_influencers').select('influencer_id').eq('campaign_id', campaignId),
    admin.from('campaign_influencer_notifications').select('influencer_id').eq('campaign_id', campaignId),
  ])

  const excludeIds = new Set([
    ...(existingRows ?? []).map(r => r.influencer_id).filter(Boolean),
    ...(notifiedRows ?? []).map(r => r.influencer_id).filter(Boolean),
  ])

  // Sin filtro por organization_id: las marcas quedan con organization_id propia
  // y aislada (fix 2026-07-02), así que filtrar por la org de la campaña dejaría
  // fuera a casi todo el roster.
  const { data: candidates, error: infErr } = await admin
    .from('influencers')
    .select('id, user_id, display_name, email')
    .eq('is_active', true)
    .not('email', 'is', null)

  if (infErr || !candidates) {
    console.error('[resolvePendingCampaignAnnouncement] error listando influencers', infErr)
    return { campaign, pending: [], skipped: 'query_error' as const }
  }

  // La comunicación de campañas es siempre voluntaria. Una cuenta sin
  // preferencias guardadas conserva el valor inicial del formulario (recibir).
  const userIds = candidates.map(inf => inf.user_id).filter((id): id is string => Boolean(id))
  const optedOut = new Set<string>()
  for (let i = 0; i < userIds.length; i += 500) {
    const { data: profiles } = await admin.from('profiles').select('id, metadata').in('id', userIds.slice(i, i + 500))
    for (const profile of profiles ?? []) {
      const metadata = profile.metadata && typeof profile.metadata === 'object'
        ? profile.metadata as Record<string, unknown>
        : {}
      const preferences = metadata.notification_preferences && typeof metadata.notification_preferences === 'object'
        ? metadata.notification_preferences as Record<string, unknown>
        : {}
      if (preferences.public_campaigns_email === false) optedOut.add(profile.id)
    }
  }

  const pending = candidates
    .filter(inf => !excludeIds.has(inf.id))
    .filter(inf => !inf.user_id || !optedOut.has(inf.user_id))

  return { campaign, pending, skipped: undefined }
}

/**
 * announceCampaignToInfluencers — envía el aviso de campaña disponible a todas
 * las influencers pendientes (o a las primeras `limit`, para el botón manual).
 *
 * Reutiliza el template campaignOpenAvailableEmail y la tabla de idempotencia
 * campaign_influencer_notifications, que es lo que garantiza que reactivar una
 * campaña no reenvíe correos.
 *
 * No lanza excepción: un fallo de email nunca debe bloquear la activación.
 */
export async function announceCampaignToInfluencers(
  campaignId: string,
  admin: ReturnType<typeof createAdminClient>,
  options: { limit?: number } = {}
): Promise<{ sent: number; failed: number; remaining: number; skipped?: string }> {
  try {
    const { campaign, pending, skipped } = await resolvePendingCampaignAnnouncement(campaignId, admin)
    if (!campaign || skipped) return { sent: 0, failed: 0, remaining: 0, skipped }
    if (pending.length === 0) return { sent: 0, failed: 0, remaining: 0 }

    const targets = typeof options.limit === 'number' ? pending.slice(0, options.limit) : pending
    const requiresPro = campaign.visibility === 'private'

    let sent = 0
    let failed = 0

    for (let i = 0; i < targets.length; i += BATCH_SIZE) {
      const chunk = targets.slice(i, i + BATCH_SIZE)
      try {
        const { error: batchErr } = await getResend().batch.send(
          chunk.map(inf => ({
            from: FROM_EMAIL,
            to: inf.email as string,
            subject: `Nueva campaña disponible: ${campaign.name} — cupos limitados`,
            html: campaignOpenAvailableEmail({
              influencerName: inf.display_name ?? 'influencer',
              campaignName: campaign.name,
              campaignType: campaign.type,
              applyUrl: `${APP_URL}/inf-campaign/${campaign.id}`,
              requiresPro,
            }),
          }))
        )
        if (batchErr) throw new Error(batchErr.message ?? 'Resend batch error')

        // Solo se marca como notificada la influencer a la que el envío salió
        // bien: si un chunk falla, queda pendiente para el siguiente intento.
        const { error: markErr } = await admin
          .from('campaign_influencer_notifications')
          .upsert(
            chunk.map(inf => ({ campaign_id: campaignId, influencer_id: inf.id })),
            { onConflict: 'campaign_id,influencer_id' }
          )
        if (markErr) console.error('[announceCampaignToInfluencers] error marcando notificadas', markErr)
        sent += chunk.length
      } catch (e) {
        console.error('[announceCampaignToInfluencers] error en batch', e)
        failed += chunk.length
      }
    }

    return { sent, failed, remaining: Math.max(0, pending.length - sent) }
  } catch (e) {
    console.error('[announceCampaignToInfluencers] fallo no bloqueante', e)
    return { sent: 0, failed: 0, remaining: 0, skipped: 'exception' }
  }
}

/**
 * Alias histórico: se mantiene el nombre que ya importa
 * PATCH /api/campaigns/[id] para no tocar ese call site.
 */
export const notifyAllInfluencersOfOpenCampaign = (
  campaignId: string,
  admin: ReturnType<typeof createAdminClient>
) => announceCampaignToInfluencers(campaignId, admin)

/**
 * notifyPreassignedInfluencersOnActivation — al activar una campaña (pública o
 * privada), avisa UNA sola vez a las influencers que fueron PREASIGNADAS
 * mientras la campaña estaba en borrador (invitaciones pendientes o altas
 * directas ya aceptadas). En draft esos emails se difieren; acá se envían.
 *
 * Reutiliza la misma tabla de idempotencia (campaign_influencer_notifications):
 * si a alguien ya se le avisó, no se le vuelve a escribir. Complementa a
 * notifyAllInfluencersOfOpenCampaign, que EXCLUYE justamente a las preasignadas
 * (las que ya tienen fila en campaign_influencers) — entre ambas se cubre a
 * todas sin duplicar.
 *
 * No lanza excepción: un fallo de email nunca bloquea la activación.
 */
export async function notifyPreassignedInfluencersOnActivation(
  campaignId: string,
  admin: ReturnType<typeof createAdminClient>
): Promise<{ sent: number; failed: number; skipped?: string }> {
  try {
    const { data: campaign } = await admin
      .from('campaigns')
      .select('id, name, type, brand_id')
      .eq('id', campaignId)
      .maybeSingle()

    if (!campaign) return { sent: 0, failed: 0, skipped: 'no_campaign' }

    let brandName = ''
    if (campaign.brand_id) {
      const { data: b } = await admin.from('brands').select('name').eq('id', campaign.brand_id).maybeSingle()
      brandName = b?.name ?? ''
    }

    const [{ data: ciRows }, { data: notifiedRows }] = await Promise.all([
      admin.from('campaign_influencers')
        .select('influencer_id, application_status, origin, message, influencer:influencers (display_name, email, is_active)')
        .eq('campaign_id', campaignId)
        .not('application_status', 'eq', 'rejected'),
      admin.from('campaign_influencer_notifications').select('influencer_id').eq('campaign_id', campaignId),
    ])

    const notified = new Set((notifiedRows ?? []).map(r => r.influencer_id).filter(Boolean))

    type Row = {
      influencer_id: string
      application_status: string | null
      origin: string | null
      message: string | null
      influencer: { display_name: string | null; email: string | null; is_active: boolean | null } | null
    }
    const targets = ((ciRows ?? []) as unknown as Row[]).filter(r =>
      r.influencer?.is_active && r.influencer?.email && !notified.has(r.influencer_id)
    )

    if (targets.length === 0) return { sent: 0, failed: 0 }

    let sent = 0
    let failed = 0

    for (const r of targets) {
      const inf = r.influencer!
      try {
        const isInvitationPending = r.origin === 'invitation' && r.application_status === 'pending'
        const html = isInvitationPending
          ? influencerInviteEmail({
              influencerName: inf.display_name ?? 'influencer',
              campaignName:   campaign.name,
              brandName:      brandName || 'Una marca',
              inviteUrl:      `${APP_URL}/inf-campaigns`,
              message:        r.message ?? undefined,
            })
          : campaignAssignedEmail({
              influencerName: inf.display_name ?? 'Influencer',
              campaignName:   campaign.name,
              campaignType:   campaign.type,
              campaignUrl:    `${APP_URL}/inf-campaign/${campaign.id}`,
            })
        const subject = isInvitationPending
          ? 'Fuiste seleccionada para una campaña privada ✨'
          : `Fuiste asignada a la campaña "${campaign.name}"`

        const { error: emailErr } = await getResend().emails.send({
          from: FROM_EMAIL,
          to:   inf.email as string,
          subject,
          html,
        })
        if (emailErr) throw new Error(emailErr.message ?? 'Resend error')

        await admin
          .from('campaign_influencer_notifications')
          .upsert({ campaign_id: campaignId, influencer_id: r.influencer_id }, { onConflict: 'campaign_id,influencer_id' })
        sent += 1
      } catch (e) {
        console.error('[notifyPreassignedInfluencersOnActivation] fallo email', e)
        failed += 1
      }
    }

    return { sent, failed }
  } catch (e) {
    console.error('[notifyPreassignedInfluencersOnActivation] fallo no bloqueante', e)
    return { sent: 0, failed: 0, skipped: 'exception' }
  }
}
