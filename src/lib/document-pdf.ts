export type PdfDocument = {
  title: string
  content_snapshot: string
  status: string
  signer_name: string | null
  signer_rut: string | null
  signer_role: string | null
  signer_email: string | null
  signed_at: string | null
  due_at: string
}

/** Generates the exact same legal PDF from both the brand and admin portals. */
export async function downloadDocumentPdf(document: PdfDocument) {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const margin = 42
  const contentWidth = pageWidth - margin * 2
  const footerY = pageHeight - 24
  const bottomLimit = footerY - 18
  let y = 43

  const ensureSpace = (lineHeight: number) => {
    if (y + lineHeight <= bottomLimit) return
    pdf.addPage()
    y = 43
  }

  const add = (text: string, size: number, bold = false, gapAfter = 0) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal')
    pdf.setFontSize(size)
    const lineHeight = Math.round(size * 1.28 * 10) / 10
    const paragraphs = text.split('\n')

    for (const paragraph of paragraphs) {
      if (!paragraph.trim()) {
        y += lineHeight * 0.55
        continue
      }
      const lines = pdf.splitTextToSize(paragraph, contentWidth) as string[]
      for (const line of lines) {
        ensureSpace(lineHeight)
        pdf.text(line, margin, y)
        y += lineHeight
      }
    }
    y += gapAfter
  }

  // The NDA is deliberately compact so its standard legal text and signature
  // evidence fit on a single A4 page without reducing legibility.
  add('SCENCE · DOCUMENTO ELECTRÓNICO', 7.5, true, 5)
  add(document.title.toUpperCase(), 12, true, 8)
  add(document.content_snapshot, 7.7, false, 7)
  add('EVIDENCIA DE FIRMA', 8, true, 3)

  const evidence = document.status === 'signed'
    ? [
        `Firmado por: ${document.signer_name ?? '—'}`,
        `RUT: ${document.signer_rut ?? '—'} · Cargo: ${document.signer_role ?? '—'}`,
        `Email: ${document.signer_email ?? '—'}`,
        `Fecha: ${document.signed_at ? new Date(document.signed_at).toLocaleString('es-CL') : '—'}`,
      ].join('\n')
    : `Documento pendiente de firma. Vence: ${new Date(document.due_at).toLocaleDateString('es-CL')}`
  add(evidence, 7.5)

  const totalPages = pdf.getNumberOfPages()
  for (let page = 1; page <= totalPages; page += 1) {
    pdf.setPage(page)
    pdf.setDrawColor(210, 210, 210)
    pdf.line(margin, footerY - 8, pageWidth - margin, footerY - 8)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(7)
    pdf.setTextColor(105, 105, 105)
    pdf.text(`Página ${page} de ${totalPages}`, pageWidth / 2, footerY, { align: 'center' })
    pdf.setTextColor(0, 0, 0)
  }

  pdf.save(`${document.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.pdf`)
}
