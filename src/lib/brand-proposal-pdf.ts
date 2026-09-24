import { downloadDocumentPdf } from '@/lib/document-pdf'
import { formatProposalDateTime, type ProposalStatus } from '@/lib/brand-proposal'

// PDF de la propuesta: mismo generador que NDA/contratos (lib/document-pdf),
// con el bloque final de estado en vez de "evidencia de firma".
export async function downloadProposalPdf(proposal: {
  title: string
  content: string
  status: ProposalStatus
  valid_until: string
  accept_deadline: string
  accepted_at?: string | null
}) {
  const text = proposal.status === 'accepted' && proposal.accepted_at
    ? `Propuesta aceptada el ${formatProposalDateTime(proposal.accepted_at)}. El contrato definitivo formaliza las condiciones.`
    : proposal.status === 'expired'
      ? `Propuesta vencida (plazo de aceptación: ${formatProposalDateTime(proposal.accept_deadline)}).`
      : `Vigente hasta el ${formatProposalDateTime(proposal.valid_until)}. Aceptar antes del ${formatProposalDateTime(proposal.accept_deadline)}.`
  await downloadDocumentPdf({
    title: proposal.title,
    content_snapshot: proposal.content,
    status: proposal.status,
    signer_name: null, signer_rut: null, signer_role: null, signer_email: null, signed_at: null,
    due_at: proposal.accept_deadline,
    evidence: { title: 'ESTADO DE LA PROPUESTA', text },
  })
}
