import type { SupabaseClient } from '@supabase/supabase-js'
import { syncDeliverableTask } from '@/lib/influencer-tasks'
import { getResend, FROM_EMAIL, campaignApplicationApprovedEmail } from '@/lib/resend'

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
      id, influencer_id, application_status, fee, deliverables_spec,
      influencer:influencers ( display_name, email )
    `)
    .eq('id', applicationId)
    .eq('campaign_id', campaignId)
    .single()

  const app = application as unknown as {
    id: string; influencer_id: string; application_status: string | null; fee: number | null
    deliverables_spec: unknown
    influencer: { display_name: string; email: string | null } | null
  } | null

  if (!app) return { ok: false, error: 'Postulación no encontrada', status: 404 }
  if (app.application_status && app.application_status !== 'pending') {
    return { ok: false, error: 'Esta postulación ya fue gestionada', status: 422 }
  }

  const { data: campaign } = await admin
    .from('campaigns')
    .select('id, name, organization_id, status, brand_id, deliverable_templates')
    .eq('id', campaignId)
    .single()

  if (!campaign) return { ok: false, error: 'Campaña no encontrada', status: 404 }

  const { error: updateError } = await admin
    .from('campaign_influencers')
    .update({
      application_status: 'accepted',
      status: 'active',
      fee: agreedFee ?? app.fee ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', applicationId)

  if (updateError) return { ok: false, error: updateError.message, status: 500 }

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
            (templates as Array<{ type: string; quantity?: number; description?: string; due_date?: string; platform?: string }>).map(t => ({
              campaign_id:            campaignId,
              influencer_id:          app.influencer_id,
              campaign_influencer_id: applicationId,
              type:                   t.type,
              title:                  t.description || t.type,
              quantity:               t.quantity ?? 1,
              platform:               t.platform ?? null,
              due_date:               t.due_date ?? null,
              status:                 'pending',
            }))
          )
          .select('id, type, title, due_date')

        if (insertDelErr) {
          console.error('[acceptCampaignApplication] insert deliverables failed:', insertDelErr.message)
        } else if (insertedDelivs?.length) {
          for (const del of insertedDelivs) {
            await syncDeliverableTask(admin, {
              organizationId:    campaign.organization_id,
              influencerId:      app.influencer_id,
              deliverableId:     del.id,
              campaignId:        campaignId,
              deliverableType:   del.type,
              deliverableTitle:  del.title,
              deliverableStatus: 'pending',
              dueDate:           del.due_date ?? null,
            })
          }
        }
      }
    }
  } catch (e) {
    console.error('[acceptCampaignApplication] auto-deliverables failed:', e)
  }

  // Activar la campaña si estaba en draft/pending_approval
  if (['draft', 'pending_approval'].includes(campaign.status ?? '')) {
    await admin
      .from('campaigns')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('id', campaignId)
  }

  // Email de aprobación — no bloqueante
  if (app.influencer?.email) {
    try {
      let brandName: string | null = null
      if (campaign.brand_id) {
        const { data: brand } = await admin.from('brands').select('name').eq('id', campaign.brand_id).maybeSingle()
        brandName = brand?.name ?? null
      }

      // NOTA: el SDK de Resend NO lanza excepción en errores de la API (key
      // inválida, dominio no verificado, etc.) — devuelve { data, error } sin
      // throw. Antes no se revisaba `error`, así que un fallo de Resend quedaba
      // completamente silencioso (sin log, sin señal de que no llegó el email).
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

  return { ok: true }
}
