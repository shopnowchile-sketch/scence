import type { SupabaseClient } from '@supabase/supabase-js'
import { ADMIN_NOTIFICATION_EMAIL, FROM_EMAIL, getResend } from '@/lib/resend'
import { emailAudience } from '@/lib/inactive-influencer-email-guard'
import { escapeHtml } from '@/lib/utils'
import { formatProposalDateTime, type ProposalRecord } from '@/lib/brand-proposal'

// Avisos del flujo de propuestas. Reutiliza getResend() (barrera única de
// envío) con audiencia declarada, y la tabla notifications existente.
// Ningún fallo de aviso revierte la operación ya guardada: se informa.

const appUrl = () => process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'

function shell(title: string, body: string, cta: { label: string; url: string }) {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto"><div style="background:#7c3aed;color:white;padding:24px;font-size:22px;font-weight:800">SCENCE</div><div style="padding:28px"><h1 style="font-size:20px;color:#111827">${escapeHtml(title)}</h1>${body}<p style="margin-top:24px"><a href="${cta.url}" style="background:#7c3aed;color:white;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:700">${escapeHtml(cta.label)}</a></p></div></div>`
}

export async function notifyBrandProposalIssued(admin: SupabaseClient, input: {
  brand: { id: string; name: string; contact_email: string | null }
  proposal: ProposalRecord
  applicationId: string
}): Promise<{ email_sent: boolean; in_app: boolean }> {
  const { brand, proposal } = input
  const url = `${appUrl()}/brand-opportunities`
  let emailSent = false
  if (brand.contact_email) {
    const { error } = await getResend().emails.send({
      from: FROM_EMAIL,
      to: brand.contact_email,
      tags: [emailAudience('brand')],
      subject: `Propuesta comercial: ${proposal.campaign_snapshot.name} · Plan ${proposal.plan_snapshot.name}`,
      html: shell(
        `Tienes una propuesta de SCENCE para ${brand.name}`,
        `<p style="color:#374151">Te enviamos la propuesta del plan <b>${escapeHtml(proposal.plan_snapshot.name)}</b> para <b>${escapeHtml(proposal.campaign_snapshot.name)}</b>.</p><p style="color:#374151">Para mantener las condiciones, acéptala antes del <b>${escapeHtml(formatProposalDateTime(proposal.accept_by))}</b>.</p>`,
        { label: 'Ver propuesta', url },
      ),
    })
    emailSent = !error
    if (error) console.error('[brand-proposal] email marca', error)
  }
  const { data: members } = await admin.from('organization_members').select('user_id').eq('brand_id', brand.id).eq('is_active', true)
  let inApp = false
  if (members?.length) {
    const { error } = await admin.from('notifications').insert(members.map(member => ({
      recipient_id: member.user_id, type: 'campaign_update',
      title: `Nueva propuesta: ${proposal.campaign_snapshot.name}`,
      body: `Plan ${proposal.plan_snapshot.name}. Acepta antes del ${formatProposalDateTime(proposal.accept_by)}.`,
      action_url: '/brand-opportunities', entity_type: 'campaign_brand_application', entity_id: input.applicationId, sent_via: ['in_app'],
    })))
    inApp = !error
    if (error) console.error('[brand-proposal] notificación marca', error)
  }
  return { email_sent: emailSent, in_app: inApp }
}

export async function notifyAdminProposalAccepted(admin: SupabaseClient, input: {
  organizationId: string
  campaignId: string
  brandName: string
  proposal: ProposalRecord
  applicationId: string
}): Promise<void> {
  const { proposal } = input
  const title = `${input.brandName} aceptó la propuesta`
  const body = `Plan ${proposal.plan_snapshot.name} · ${proposal.campaign_snapshot.name} (v${proposal.version}).`
  const { data: members } = await admin.from('organization_members').select('user_id, role, is_owner').eq('organization_id', input.organizationId).eq('is_active', true)
  const admins = (members ?? []).filter(member => member.is_owner || member.role === 'super_admin')
  if (admins.length) {
    const { error } = await admin.from('notifications').insert(admins.map(member => ({
      recipient_id: member.user_id, type: 'campaign_update', title, body,
      action_url: `/admin-campaigns/${input.campaignId}?tab=contracts`, entity_type: 'campaign_brand_application', entity_id: input.applicationId, sent_via: ['in_app'],
    })))
    if (error) console.error('[brand-proposal] notificación admin', error)
  }
  const { error } = await getResend().emails.send({
    from: FROM_EMAIL, to: ADMIN_NOTIFICATION_EMAIL, tags: [emailAudience('admin')], subject: title,
    html: shell(title, `<p style="color:#374151">${escapeHtml(body)}</p><p style="color:#374151">Siguiente paso: generar el contrato.</p>`, { label: 'Abrir campaña', url: `${appUrl()}/admin-campaigns/${input.campaignId}?tab=contracts` }),
  })
  if (error) console.error('[brand-proposal] email admin', error)
}
