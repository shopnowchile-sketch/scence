export const INFLUENCER_PRO_TERMS = {
  key: 'influencer_pro_terms',
  title: 'Términos y Condiciones – Plan Pro Influencer',
  version: '2.0',
  effectiveDate: '3 de septiembre de 2026',
  sections: [
    { title: '1. Objeto del Plan Pro', body: 'El Plan Pro corresponde a una suscripción mensual recurrente mediante PayPal que entrega acceso a funcionalidades, oportunidades y beneficios específicos dentro de SCENCE. El pago corresponde al acceso al plan y no constituye un pago por ser seleccionado, invitado o contratado para campañas, eventos o colaboraciones.' },
    { title: '2. Beneficios', body: 'El Plan Pro permite postular a eventos o campañas exclusivas (privadas) disponibles para usuarios Pro, entrega prioridad para ser considerado en determinadas invitaciones públicas y puede habilitar invitaciones VIP. También pueden existir descuentos en campañas pagadas u otros beneficios, siempre sujetos a las condiciones particulares y disponibilidad de cada campaña.' },
    { title: '3. No garantía de selección', body: 'TENER PLAN PRO NO GARANTIZA SER SELECCIONADO, INVITADO NI CONTRATADO PARA NINGUNA CAMPAÑA, EVENTO O COLABORACIÓN. La marca o cliente mantiene plena libertad para aprobar o rechazar postulaciones según sus criterios y los requisitos de cada oportunidad.' },
    { title: '4. Ausencia de resultados garantizados', body: 'SCENCE no garantiza una cantidad mínima de campañas, invitaciones, ingresos, colaboraciones, selecciones ni contrataciones como consecuencia de contratar el Plan Pro.' },
    { title: '5. Suscripción y activación', body: 'La aceptación de estos términos no activa el Plan Pro. El plan se activa exclusivamente después de la confirmación válida de la suscripción y pago recurrente mediante PayPal. La facturación es mensual y se mantiene hasta su cancelación.' },
    { title: '6. Visibilidad de campañas privadas', body: 'Las campañas privadas son visibles para todas las influencers, tengan o no Plan Pro. Solo una influencer con Plan Pro activo puede postular por su cuenta a una campaña privada. Una influencer sin Plan Pro (Gratis) solo puede participar en una campaña privada si recibió una invitación directa de la marca o de SCENCE; en ese caso, no necesita contratar el Plan Pro.' },
    { title: '7. Vigencia del Plan Pro durante el proceso', body: 'Quien postula a una campaña privada mediante Plan Pro debe mantener la suscripción activa durante todo el proceso de postulación y, si es seleccionada, hasta finalizar la campaña. Si la suscripción se cancela o pierde vigencia mientras la postulación está pendiente o aceptada, la postulación o selección queda rechazada o inelegible automáticamente, salvo que la influencer cuente con una invitación directa a esa misma campaña.' },
    { title: '8. Campañas y compromisos', body: 'Cuando el Plan Pro se contrata desde una campaña, la suscripción puede quedar vinculada a esa campaña. La cancelación estará sujeta a que la campaña haya finalizado y a que todos los entregables obligatorios estén completos.' },
    { title: '9. Cancelación y cuenta', body: 'Cancelar la suscripción afecta su renovación y no elimina el historial de aceptaciones. Desactivar la cuenta bloquea el acceso a SCENCE, pero tampoco elimina documentos ni registros históricos asociados.' },
    { title: '10. Versionado', body: 'La aceptación queda asociada a esta versión. Debes aceptar la versión vigente de estos términos antes de tu próxima postulación a una campaña privada. Si los términos cambian sustancialmente, SCENCE publicará una nueva versión y podrá requerir una nueva aceptación, conservando siempre el historial anterior.' },
  ],
} as const

export const INFLUENCER_PRO_TERMS_SNAPSHOT = [
  INFLUENCER_PRO_TERMS.title,
  `Versión ${INFLUENCER_PRO_TERMS.version} · Vigente desde ${INFLUENCER_PRO_TERMS.effectiveDate}`,
  ...INFLUENCER_PRO_TERMS.sections.flatMap(section => [section.title, section.body]),
].join('\n\n')

/**
 * Acepta la versión vigente de los Términos del Plan Pro reutilizando el
 * endpoint existente POST /api/influencer/terms.
 *
 * Necesario porque una influencer puede llevar meses con Pro activo y tener su
 * última aceptación en una versión anterior (hoy: aceptaciones en 1.0 con la
 * versión vigente en 2.0). En ese caso /apply responde 409
 * INFLUENCER_PRO_TERMS_REQUIRED y la postulación no se puede completar desde
 * ninguna pantalla. No duplica lógica: es el mismo POST que ya hace
 * InfluencerPlanSettings al contratar el plan.
 */
export async function acceptCurrentInfluencerProTerms(): Promise<void> {
  const response = await fetch('/api/influencer/terms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      accepted: true,
      document_key: INFLUENCER_PRO_TERMS.key,
      version: INFLUENCER_PRO_TERMS.version,
    }),
  })
  if (!response.ok) {
    const result = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(result.error ?? 'No se pudo registrar la aceptación de los Términos del Plan Pro.')
  }
}

/**
 * ¿La influencer ya aceptó la versión VIGENTE de los Términos Pro?
 * Reutiliza el GET que ya existe en /api/influencer/terms (devuelve las
 * aceptaciones y `current_version`); no agrega endpoint ni columna. Sirve para
 * saber ANTES de postular si la confirmación debe incluir el consentimiento,
 * en vez de descubrirlo por el 409 del backend y abrir una segunda ventana.
 */
export async function hasAcceptedCurrentInfluencerProTerms(): Promise<boolean> {
  const response = await fetch('/api/influencer/terms')
  if (!response.ok) return false
  const result = await response.json().catch(() => ({})) as {
    data?: Array<{ document_key?: string; document_version?: string; status?: string }>
    current_version?: string
  }
  const current = result.current_version ?? INFLUENCER_PRO_TERMS.version
  return (result.data ?? []).some(row =>
    row.document_key === INFLUENCER_PRO_TERMS.key
    && row.document_version === current
    && row.status === 'accepted')
}

/**
 * Descarga los Términos Pro vigentes en PDF, generados en el cliente desde la
 * MISMA constante que se muestra y se firma (INFLUENCER_PRO_TERMS). No cambia
 * el texto ni la versión; jspdf ya es dependencia del proyecto.
 */
export async function downloadInfluencerProTermsPdf(): Promise<void> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const marginX = 56
  const maxWidth = 595 - marginX * 2
  let y = 64

  const write = (text: string, size: number, bold: boolean, gap: number) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(size)
    for (const line of doc.splitTextToSize(text, maxWidth) as string[]) {
      if (y > 780) { doc.addPage(); y = 64 }
      doc.text(line, marginX, y)
      y += size + 4
    }
    y += gap
  }

  write(INFLUENCER_PRO_TERMS.title, 16, true, 4)
  write(`Versión ${INFLUENCER_PRO_TERMS.version} · Vigente desde ${INFLUENCER_PRO_TERMS.effectiveDate}`, 10, false, 16)
  for (const section of INFLUENCER_PRO_TERMS.sections) {
    write(section.title, 12, true, 2)
    write(section.body, 10, false, 12)
  }
  doc.save(`Terminos-Plan-Pro-SCENCE-v${INFLUENCER_PRO_TERMS.version}.pdf`)
}
