import { applyCrmPresentationVariables } from '@/lib/email-catalog'
import { crmCatalogEmail } from '@/lib/crm-email-html'

export default function PresentationPreview({ lead, subject, message }: {
  lead: { contact_name?: string | null; company_name?: string | null }
  subject: string
  message: string
}) {
  const resolvedSubject = applyCrmPresentationVariables(subject.trim(), lead).replace(/[\r\n]+/g, ' ').slice(0, 180)
  const html = crmCatalogEmail({
    message: applyCrmPresentationVariables(message.trim(), lead),
    presentation: true,
    unsubscribeUrl: '#',
  })

  return (
    <details className="rounded-xl border border-gray-200 bg-white p-3">
      <summary className="cursor-pointer text-sm font-semibold text-gray-700">Vista previa del correo</summary>
      <p className="my-3 break-words text-sm text-gray-900"><strong>Asunto</strong> {resolvedSubject}</p>
      <iframe
        title="Correo personalizado"
        sandbox=""
        srcDoc={html}
        className="h-96 w-full rounded-lg border border-gray-100"
      />
    </details>
  )
}
