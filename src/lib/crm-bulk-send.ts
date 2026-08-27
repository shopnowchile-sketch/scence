import { createAdminClient } from '@/lib/supabase/server'
import { applyEmailVariables, CRM_EMAIL_CATALOG } from '@/lib/email-catalog'
import { getResend, FROM_EMAIL, crmCatalogEmail } from '@/lib/resend'

// Tamaño de tanda por invocación — mismo límite que existía antes como tope
// duro (era "máximo 50 por vez"), ahora es el tamaño de cada lote interno del
// job en background, no un límite para el usuario.
export const BATCH_SIZE = 50

function defaultPlainMessage(lead: { contact_name: string | null; company_name: string | null }) {
  const name = lead.contact_name?.trim() || 'hola'
  const companyName = lead.company_name ?? 'tu marca'

  return `Hola ${name},

Soy Pri de SCENCE. Estamos conectando marcas chilenas con creadoras de contenido para campañas, eventos, canjes y UGC.

Vi ${companyName} y creo que podría calzar muy bien para probar una primera campaña con creadoras.

¿Te gustaría que te enviemos más información?

Saludos,
Priscilla
SCENCE`
}

// Manda una tanda de leads (ya resueltos, con datos de contacto) por Resend.
// Reusa exactamente la misma lógica que tenía el bulk-send original de una
// sola tanda — solo se movió a un helper compartido para que lo use el
// endpoint de background (una tanda por invocación).
export async function sendLeadBatch(
  admin: ReturnType<typeof createAdminClient>,
  leads: Array<{
    id: string
    contact_name: string | null
    company_name: string | null
    email: string | null
    qualification_status: string
  }>,
  subject: string,
  customMessage: string,
  userId: string,
  templateKey = 'crm_intro'
) {
  let sent = 0
  let skipped = 0
  let failed = 0
  const template = CRM_EMAIL_CATALOG.find(item => item.key === templateKey) ?? CRM_EMAIL_CATALOG[0]

  for (const lead of leads) {
    if (!lead.email) {
      skipped++
      continue
    }

    const companyName = lead.company_name?.trim() || 'tu marca'
    const variables = {
      contact_name: lead.contact_name?.trim() || `equipo de ${companyName}`,
      company_name: companyName,
    }
    const message = applyEmailVariables(customMessage || template?.defaultMessage || defaultPlainMessage(lead), variables)
    const resolvedSubject = applyEmailVariables(subject || template?.defaultSubject || 'Conoce SCENCE', variables)
    const html = crmCatalogEmail({
      message,
      buttonLabel: template?.defaultButtonLabel,
      buttonUrl: template?.defaultButtonUrl,
    })

    const { data: emailData, error: emailError } = await getResend().emails.send({
      from: FROM_EMAIL,
      to: lead.email,
      subject: resolvedSubject,
      html,
      text: message,
    })

    const now = new Date().toISOString()
    const resendEmailId = emailData?.id ?? null

    if (emailError) {
      failed++
      await admin.from('crm_lead_activities').insert({
        lead_id: lead.id,
        action_type: 'email_sent',
        description: `Envío masivo falló a ${lead.email}: ${emailError.message ?? 'error desconocido'}`,
        created_by: userId,
      })
      continue
    }

    sent++

    await admin.from('crm_email_events').insert({
      lead_id: lead.id,
      resend_email_id: resendEmailId,
      event_type: 'email.sent',
      recipient_email: lead.email,
      subject: resolvedSubject,
      raw_payload: {
        source: 'bulk-send',
        email_type: template?.name ?? 'Envío masivo CRM',
        template_key: template?.key ?? templateKey,
        resend_email_id: resendEmailId,
      },
    })

    await admin.from('crm_leads').update({
      contacted_at: now,
      updated_at: now,
      qualification_status: lead.qualification_status === 'converted' ? 'converted' : 'contacted',
    }).eq('id', lead.id)

    await admin.from('crm_lead_activities').insert({
      lead_id: lead.id,
      action_type: 'email_sent',
      description: `Tipo: ${template?.name ?? 'Envío masivo CRM'} · Para: ${lead.email} · Asunto: ${resolvedSubject}`,
      created_by: userId,
    })

    await new Promise(resolve => setTimeout(resolve, 150))
  }

  return { sent, skipped, failed }
}
