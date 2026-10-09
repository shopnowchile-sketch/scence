import { createAdminClient } from '@/lib/supabase/server'
import { applyEmailVariables, CRM_EMAIL_CATALOG } from '@/lib/email-catalog'
import { getResend, FROM_EMAIL, crmCatalogEmail } from '@/lib/resend'
import { buildUnsubscribeUrl, commercialEmailHeaders, getBlockedEmails, normalizeEmail } from '@/lib/email-optouts'
import { emailAudience } from '@/lib/inactive-influencer-email-guard'
import { processLeadBatch, BATCH_SIZE, type BatchLead, type BatchResult } from '@/lib/crm-send-guard'

// Tamaño de tanda por invocación (definido en crm-send-guard.ts para que la reanudación
// manual use exactamente el mismo valor). Es el tamaño de cada lote interno del job en
// background, no un límite para el usuario.
export { BATCH_SIZE }

// Manda una tanda de leads por Resend. La lógica de protección (reserva atómica
// por lead, ledger por job, envíos no confirmados) vive en `processLeadBatch`
// (crm-send-guard.ts); acá solo se arma el email de cada lead con el mismo
// catálogo y layout que el envío individual.
export async function sendLeadBatch(
  admin: ReturnType<typeof createAdminClient>,
  leads: BatchLead[],
  jobId: string,
  subject: string,
  customMessage: string,
  userId: string,
  templateKey = 'crm_intro',
  jobCreatedAt: string
): Promise<BatchResult> {
  const template = CRM_EMAIL_CATALOG.find(item => item.key === templateKey) ?? CRM_EMAIL_CATALOG[0]

  // Bajas, rebotes permanentes y quejas de spam. Una sola consulta por tanda.
  // Se evalúa AL ENVIAR, no al seleccionar: así ningún filtro nuevo, ningún
  // "Seleccionar los 20.954" y ningún job encolado hace semanas puede colar a
  // alguien que se dio de baja. Si la consulta falla, lanza y la tanda se aborta.
  const blocked = await getBlockedEmails(admin, leads.map(lead => lead.email))

  return processLeadBatch(admin, { jobId, userId, leads, jobCreatedAt }, {
    isBlocked: email => blocked.has(normalizeEmail(email)),
    pause: () => new Promise(resolve => setTimeout(resolve, 150)),
    prepare: lead => {
      // Sin link de baja no se manda: es requisito legal y de reputación.
      const unsubscribeUrl = buildUnsubscribeUrl(lead.id)
      if (!unsubscribeUrl) {
        console.error('[crm-bulk-send] falta UNSUBSCRIBE_SECRET/INTERNAL_JOB_SECRET — no se envía sin link de baja')
        return null
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

      return {
        subject: resolvedSubject,
        message,
        templateKey: template?.key ?? templateKey,
        templateName: template?.name ?? 'Envío masivo CRM',
        send: async () => {
          const { data, error } = await getResend().emails.send({
            from: FROM_EMAIL,
            to: lead.email as string, tags: [emailAudience('crm')],
            subject: resolvedSubject,
            html,
            text: message,
            headers: commercialEmailHeaders(unsubscribeUrl),
          })
          return { id: data?.id ?? null, error }
        },
      }
    },
  })
}
