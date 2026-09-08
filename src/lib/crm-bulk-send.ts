import { createAdminClient } from '@/lib/supabase/server'
import { applyEmailVariables, CRM_EMAIL_CATALOG } from '@/lib/email-catalog'
import { getResend, FROM_EMAIL, crmCatalogEmail } from '@/lib/resend'
import { buildUnsubscribeUrl, commercialEmailHeaders, getBlockedEmails, normalizeEmail } from '@/lib/email-optouts'

// Tamaño de tanda por invocación — mismo límite que existía antes como tope
// duro (era "máximo 50 por vez"), ahora es el tamaño de cada lote interno del
// job en background, no un límite para el usuario.
export const BATCH_SIZE = 50

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

  // Bajas, rebotes permanentes y quejas de spam. Una sola consulta por tanda.
  // Se evalúa AL ENVIAR, no al seleccionar: así ningún filtro nuevo, ningún
  // "Seleccionar los 20.954" y ningún job encolado hace semanas puede colar a
  // alguien que se dio de baja.
  const blocked = await getBlockedEmails(admin, leads.map(lead => lead.email))

  for (const lead of leads) {
    if (!lead.email) {
      skipped++
      continue
    }

    if (blocked.has(normalizeEmail(lead.email))) {
      skipped++
      await admin.from('crm_lead_activities').insert({
        lead_id: lead.id,
        action_type: 'note',
        description: `Envío comercial omitido: ${lead.email} está en la lista de bajas (unsubscribe, rebote permanente o queja de spam).`,
        created_by: userId,
      })
      continue
    }

    // Sin link de baja no se manda: es requisito legal y de reputación.
    const unsubscribeUrl = buildUnsubscribeUrl(lead.id)
    if (!unsubscribeUrl) {
      failed++
      console.error('[crm-bulk-send] falta UNSUBSCRIBE_SECRET/INTERNAL_JOB_SECRET — no se envía sin link de baja')
      continue
    }

    const companyName = lead.company_name?.trim() || 'tu marca'
    const variables = {
      contact_name: lead.contact_name?.trim() || `equipo de ${companyName}`,
      company_name: companyName,
    }
    const message = applyEmailVariables(customMessage || template?.defaultMessage || '', variables)
    const resolvedSubject = applyEmailVariables(subject || template?.defaultSubject || 'Hola, ¿cómo estás?', variables)
    const html = crmCatalogEmail({
      message,
      buttonLabel: template?.defaultButtonLabel,
      buttonUrl: template?.defaultButtonUrl,
      unsubscribeUrl,
    })

    const { data: emailData, error: emailError } = await getResend().emails.send({
      from: FROM_EMAIL,
      to: lead.email,
      subject: resolvedSubject,
      html,
      text: message,
      headers: commercialEmailHeaders(unsubscribeUrl),
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

    // Solo avanza a "Contactada" si el lead todavía no entró al pipeline. Un
    // lead en interested/building/converted no retrocede por recibir otro email.
    const entersPipeline = lead.qualification_status === 'unqualified' || lead.qualification_status === 'qualified'

    await admin.from('crm_leads').update({
      contacted_at: now,
      updated_at: now,
      ...(entersPipeline ? { qualification_status: 'contacted' } : {}),
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
