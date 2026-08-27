import { createAdminClient } from '@/lib/supabase/server'
import { getResend, FROM_EMAIL, crmIntroEmail } from '@/lib/resend'

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
  userId: string
) {
  let sent = 0
  let skipped = 0
  let failed = 0

  for (const lead of leads) {
    if (!lead.email) {
      skipped++
      continue
    }

    const message = customMessage || defaultPlainMessage(lead)
    const html = customMessage
      ? `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;white-space:pre-wrap">${message}</div>`
      : crmIntroEmail({
          contactName: lead.contact_name ?? 'hola',
          companyName: lead.company_name ?? lead.email ?? 'tu marca',
        })

    const { data: emailData, error: emailError } = await getResend().emails.send({
      from: FROM_EMAIL,
      to: lead.email,
      subject,
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
      subject,
      raw_payload: {
        source: 'bulk-send',
        email_type: 'Envío masivo CRM',
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
      description: `Tipo: Envío masivo CRM · Para: ${lead.email} · Asunto: ${subject}`,
      created_by: userId,
    })

    await new Promise(resolve => setTimeout(resolve, 150))
  }

  return { sent, skipped, failed }
}
