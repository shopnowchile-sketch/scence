import { createAdminClient } from '@/lib/supabase/server'
import { applyCrmPresentationVariables, applyEmailVariables, CRM_EMAIL_CATALOG, CRM_PRESENTATION_KEY, CRM_REGISTER_LINKS } from '@/lib/email-catalog'
import { getResend, FROM_EMAIL } from '@/lib/resend'
import { crmCatalogEmail } from '@/lib/crm-email-html'
import { buildUnsubscribeUrl, commercialEmailHeaders, getBlockedEmails, normalizeEmail } from '@/lib/email-optouts'
import { emailAudience } from '@/lib/inactive-influencer-email-guard'
import type { LoadedAttachment } from '@/lib/crm-attachments'
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
  jobCreatedAt: string,
  attachment: LoadedAttachment | null = null
): Promise<BatchResult> {
  const template = CRM_EMAIL_CATALOG.find(item => item.key === templateKey) ?? CRM_EMAIL_CATALOG[0]

  // Bajas, rebotes permanentes y quejas de spam. Una sola consulta por tanda.
  // Se evalúa AL ENVIAR, no al seleccionar: así ningún filtro nuevo, ningún
  // "Seleccionar los 20.954" y ningún job encolado hace semanas puede colar a
  // alguien que se dio de baja. Si la consulta falla, lanza y la tanda se aborta.
  const blocked = await getBlockedEmails(admin, leads.map(lead => lead.email))

  // Consentimiento: los contactos de la importación best_people_2026_01 solo reciben
  // campañas si el export confirmó `Accepts Marketing`. Desconocido ⇒ no se envía.
  // Los contactos anteriores a esa importación mantienen sus reglas de siempre.
  for (const lead of leads) {
    if (lead.source?.startsWith('best_people_2026_01') && lead.marketing_consent !== true) blocked.add(normalizeEmail(lead.email))
  }

  return processLeadBatch(admin, { jobId, userId, leads, jobCreatedAt, templateKey: template?.key ?? templateKey }, {
    isBlocked: email => blocked.has(normalizeEmail(email)),
    pause: () => new Promise(resolve => setTimeout(resolve, 150)),
    prepare: lead => {
      // Sin link de baja no se manda: es requisito legal y de reputación.
      const unsubscribeUrl = buildUnsubscribeUrl(lead.id)
      if (!unsubscribeUrl) {
        console.error('[crm-bulk-send] falta UNSUBSCRIBE_SECRET/INTERNAL_JOB_SECRET — no se envía sin link de baja')
        return null
      }

      const presentation = template?.key === CRM_PRESENTATION_KEY
      const companyName = lead.company_name?.trim() || 'tu marca'
      const variables = {
        contact_name: lead.contact_name?.trim() || `equipo de ${companyName}`,
        company_name: companyName,
      }
      const rawMessage = customMessage || template?.defaultMessage || ''
      const rawSubject = subject || template?.defaultSubject || 'Hola, ¿cómo estás?'
      const message = presentation ? applyCrmPresentationVariables(rawMessage, lead) : applyEmailVariables(rawMessage, variables)
      const resolvedSubject = presentation
        ? applyCrmPresentationVariables(rawSubject, lead).replace(/[\r\n]+/g, ' ').slice(0, 180)
        : applyEmailVariables(rawSubject, variables)
      if (presentation && (!message.trim() || !resolvedSubject.trim())) return null
      const html = crmCatalogEmail({
        message,
        presentation,
        buttonLabel: template?.defaultButtonLabel,
        buttonUrl: template?.defaultButtonUrl,
        unsubscribeUrl,
        registerLinks: template?.registrationSection ? CRM_REGISTER_LINKS : undefined,
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
            text: presentation ? message.replace(/\*\*([^*\n]+)\*\*/g, '$1') : message,
            headers: commercialEmailHeaders(unsubscribeUrl),
            ...(attachment ? { attachments: [attachment] } : {}),
          })
          return { id: data?.id ?? null, error }
        },
      }
    },
  })
}
