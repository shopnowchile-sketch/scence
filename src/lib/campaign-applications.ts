import type { SupabaseClient } from '@supabase/supabase-js'
import { expandDeliverableTemplates, type DeliverableTemplateInput } from '@/lib/deliverable-templates'
import { getResend, FROM_EMAIL, campaignApplicationApprovedEmail } from '@/lib/resend'
import { isInfluencerPro } from '@/lib/influencer-pro'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'

/**
 * acceptCampaignApplication — lógica única para aprobar una postulación
 * (campaign_influencers.application_status: 'pending' -> 'accepted').
 *
 * Unifica lo que antes eran 2 implementaciones distintas y desincronizadas:
 *   1) PATCH /api/brand/campaigns/[id]/applications (portal Marca, fix B-11)
 *      — sí mandaba email, pero solo accesible si el usuario tiene fila en `brands`.
 *   2) PATCH /api/campaigns/[id]/influencers (portal Admin)
 *      — creaba deliverables desde deliverable_templates pero NUNCA leía/escribía
 *        application_status (filtraba por `status === 'applied'`, un valor que el
 *        flujo de postulación real nunca setea) y no mandaba email.
 *
 * Encontrado 2026-07-01 al diagnosticar "no llega email al aprobar" — la causa
 * real era que el admin nunca podía disparar esta lógica en absoluto.
 */
export async function acceptCampaignApplication(
  admin: SupabaseClient,
  params: { campaignId: string; applicationId: string; agreedFee?: number | null }
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const { campaignId, applicationId, agreedFee } = params

  const { data: application } = await admin
    .from('campaign_influencers')
    .select(`
      id, influencer_id, application_status, origin, fee, deliverables_spec,
      influencer:influencers ( display_name, email )
    `)
    .eq('id', applicationId)
    .eq('campaign_id', campaignId)
    .single()

  const app = application as unknown as {
    id: string; influencer_id: string; application_status: string | null; origin: string | null; fee: number | null
    deliverables_spec: unknown
    influencer: { display_name: string; email: string | null } | null
  } | null

  if (!app) return { ok: false, error: 'Postulación no encontrada', status: 404 }
  if (app.application_status && app.application_status !== 'pending') {
    return { ok: false, error: 'Esta postulación ya fue gestionada', status: 422 }
  }

  const { data: campaign } = await admin
    .from('campaigns')
    .select('id, name, organization_id, status, visibility, brand_id, deliverable_templates, max_influencers')
    .eq('id', campaignId)
    .single()

  if (!campaign) return { ok: false, error: 'Campaña no encontrada', status: 404 }

  // Una postulación (no invitación) a campaña privada solo pudo crearse con
  // Plan Pro activo (ver /api/influencer/campaigns/[id]/apply). Si para cuando
  // se revisa ya no tiene Pro, no se puede aprobar — mismo criterio de
  // elegibilidad en el punto de decisión, sin tocar la fila (no se rechaza
  // sola acá; ver cron close-expired-campaign-applications para el barrido
  // automático de postulaciones/aceptaciones que quedan sin Pro).
  if (app.origin === 'application' && campaign.visibility === 'private') {
    if (!(await isInfluencerPro(admin, app.influencer_id))) {
      return { ok: false, error: 'La influencer ya no cuenta con Plan Pro activo — no se puede aceptar esta postulación.', status: 422 }
    }
  }

  if (campaign.max_influencers && campaign.max_influencers > 0) {
    const { count: acceptedCount, error: countError } = await admin
      .from('campaign_influencers')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId)
      .eq('application_status', 'accepted')

    if (countError) return { ok: false, error: countError.message, status: 500 }
    if ((acceptedCount ?? 0) >= campaign.max_influencers) {
      return { ok: false, error: 'No puedes aceptar más influencers: los cupos de la campaña están completos', status: 422 }
    }
  }

  // La transición condicional es también la barrera de idempotencia del email:
  // solo la primera petición que cambia pending -> accepted continúa con los
  // efectos secundarios. Un reintento o dos aprobaciones simultáneas no pueden
  // volver a crear entregables ni enviar otro correo.
  const { data: acceptedApplication, error: updateError } = await admin
    .from('campaign_influencers')
    .update({
      application_status: 'accepted',
      status: 'active',
      fee: agreedFee ?? app.fee ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', applicationId)
    .eq('campaign_id', campaignId)
    .eq('application_status', 'pending')
    .select('id')
    .maybeSingle()

  if (updateError) return { ok: false, error: updateError.message, status: 500 }
  if (!acceptedApplication) {
    return { ok: false, error: 'Esta postulación ya fue gestionada', status: 422 }
  }

  // Email de aprobación — se intenta inmediatamente después de confirmar la
  // transición. Ninguna ruta de rechazo llama a Resend.
  if (app.influencer?.email) {
    try {
      let brandName: string | null = null
      if (campaign.brand_id) {
        const { data: brand } = await admin.from('brands').select('name').eq('id', campaign.brand_id).maybeSingle()
        brandName = brand?.name ?? null
      }

      const { error: emailErr } = await getResend().emails.send({
        from: FROM_EMAIL,
        to: app.influencer.email,
        subject: `¡Tu postulación a "${campaign.name}" fue aprobada!`,
        html: campaignApplicationApprovedEmail({
          influencerName: app.influencer.display_name,
          campaignName:   campaign.name,
          brandName,
          appUrl:         `${APP_URL}/inf-campaigns`,
        }),
      })
      if (emailErr) console.error('[acceptCampaignApplication] Resend devolvió error:', emailErr)
    } catch (e) {
      console.error('[acceptCampaignApplication] approval email non-fatal:', e)
    }
  }

  // Crear deliverables desde deliverable_templates de la campaña (si no existen ya)
  try {
    const { data: existingDelivs } = await admin
      .from('campaign_deliverables')
      .select('id')
      .eq('campaign_id', campaignId)
      .eq('influencer_id', app.influencer_id)
      .limit(1)

    if (!existingDelivs?.length) {
      // Preferir deliverables_spec (custom, seteado en la invitación 1-a-1
      // desde Marca) y usar deliverable_templates (default de la campaña)
      // solo si no hay spec — cubre tanto invite-con-spec como postulación
      // open (donde deliverables_spec siempre queda '[]').
      const specRaw = Array.isArray(app.deliverables_spec)
        ? app.deliverables_spec
        : (typeof app.deliverables_spec === 'string' ? JSON.parse(app.deliverables_spec || '[]') : [])

      const templates = specRaw.length > 0
        ? specRaw
        : (Array.isArray(campaign.deliverable_templates) ? campaign.deliverable_templates : [])

      if (templates.length > 0) {
        const { data: insertedDelivs, error: insertDelErr } = await admin
          .from('campaign_deliverables')
          .insert(
            expandDeliverableTemplates(templates as DeliverableTemplateInput[]).map(t => ({
              campaign_id:            campaignId,
              influencer_id:          app.influencer_id,
              campaign_influencer_id: applicationId,
              ...t,
              status:                 'pending',
            }))
          )
          .select('id')

        if (insertDelErr) {
          console.error('[acceptCampaignApplication] insert deliverables failed:', insertDelErr.message)
        }
      }
    }
  } catch (e) {
    console.error('[acceptCampaignApplication] auto-deliverables failed:', e)
  }

  // La confirmación de asistencia puede haberse agregado después de que ya
  // existían otros entregables. Se asegura de forma independiente para cada
  // nueva influencer aceptada, sin duplicar la fila.
  try {
    const templates = Array.isArray(campaign.deliverable_templates) ? campaign.deliverable_templates as Array<Record<string, unknown>> : []
    const attendanceTemplate = templates.find(template => template.type === 'event_attendance')
    if (attendanceTemplate) {
      const { data: alreadyAssigned } = await admin.from('campaign_deliverables').select('id')
        .eq('campaign_id', campaignId).eq('influencer_id', app.influencer_id).eq('type', 'event_attendance').maybeSingle()
      if (!alreadyAssigned) {
        await admin.from('campaign_deliverables').insert({
          campaign_id: campaignId, campaign_influencer_id: applicationId, influencer_id: app.influencer_id,
          type: 'event_attendance', title: attendanceTemplate.title ?? 'Confirmar asistencia',
          description: attendanceTemplate.description ?? null, due_date: attendanceTemplate.due_date ?? null,
          quantity: 1, status: 'pending',
        })
      }
    }
  } catch (error) {
    console.error('[acceptCampaignApplication] attendance confirmation failed:', error)
  }

  // NOTA (2026-07-12, pedido de Pri): antes esta función activaba la campaña
  // sola cuando estaba en draft/pending_approval. Eso se sacó — la activación
  // es una acción manual de la marca (botón "Activar", PATCH /api/campaigns/[id]
  // action=activate), que además dispara los emails de aviso
  // (notifyPreassignedInfluencersOnActivation / notifyAllInfluencersOfOpenCampaign).
  // Auto-activar acá bypasseaba ese flujo: la campaña quedaba activa sin que
  // se avisara a nadie. Aceptar una postulación/invitación ya NO cambia
  // campaigns.status — solo el status de la fila campaign_influencers.

  return { ok: true }
}

/**
 * Rechaza una o varias postulaciones usando la misma fuente de verdad.
 * No contiene ni dispara notificaciones por email.
 */
export async function rejectCampaignApplications(
  admin: SupabaseClient,
  params: { campaignId: string; applicationIds: string[] }
): Promise<{ ok: true; rejectedIds: string[] } | { ok: false; error: string; status: number }> {
  const applicationIds = Array.from(new Set(params.applicationIds.filter(Boolean)))
  if (applicationIds.length === 0) {
    return { ok: false, error: 'Selecciona al menos una postulación', status: 422 }
  }
  if (applicationIds.length > 500) {
    return { ok: false, error: 'No se pueden gestionar más de 500 postulaciones a la vez', status: 422 }
  }

  const { data: applications, error: lookupError } = await admin
    .from('campaign_influencers')
    .select('id, application_status, origin')
    .eq('campaign_id', params.campaignId)
    .in('id', applicationIds)

  if (lookupError) return { ok: false, error: lookupError.message, status: 500 }
  if (!applications || applications.length !== applicationIds.length) {
    return { ok: false, error: 'Una o más postulaciones no pertenecen a esta campaña', status: 404 }
  }
  if (applications.some(application => application.application_status !== 'pending')) {
    return { ok: false, error: 'Solo se pueden gestionar postulaciones pendientes', status: 422 }
  }

  const { data: rejected, error: updateError } = await admin
    .from('campaign_influencers')
    .update({ application_status: 'rejected', updated_at: new Date().toISOString() })
    .eq('campaign_id', params.campaignId)
    .eq('application_status', 'pending')
    .in('id', applicationIds)
    .select('id')

  if (updateError) return { ok: false, error: updateError.message, status: 500 }
  const rejectedIds = (rejected ?? []).map(application => application.id as string)
  if (rejectedIds.length !== applicationIds.length) {
    return { ok: false, error: 'Una o más postulaciones fueron gestionadas por otra solicitud', status: 409 }
  }

  return { ok: true, rejectedIds }
}
