import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getResend, FROM_EMAIL, crmCatalogEmail } from '@/lib/resend'
import { isCrmAdmin } from '@/lib/crm-auth'
import { applyEmailVariables, CRM_EMAIL_CATALOG } from '@/lib/email-catalog'
import { buildUnsubscribeUrl, commercialEmailHeaders, isOptedOut, OptOutLookupError } from '@/lib/email-optouts'
import { emailAudience } from '@/lib/inactive-influencer-email-guard'
import { claimLeadSend, releaseLeadSend, isDefinitiveResendFailure, SEND_GUARD_WINDOW_MS } from '@/lib/crm-send-guard'

type Params = { params: { id: string } }

// Envío individual desde el detalle del lead. Usa exactamente el mismo catálogo
// de templates y el mismo layout HTML (`crmCatalogEmail`) que el envío masivo
// (`src/lib/crm-bulk-send.ts`) — una sola fuente de verdad para el copy.
export async function POST(req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  if (!(await isCrmAdmin(user, admin))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({} as { subject?: string; message?: string; template_key?: string }))

  const { data: lead, error: leadErr } = await admin
    .from('crm_leads')
    .select('id, contact_name, company_name, email, qualification_status, contacted_at')
    .eq('id', params.id)
    .single()

  if (leadErr || !lead) return NextResponse.json({ error: 'Lead no encontrado' }, { status: 404 })
  if (!lead.email) return NextResponse.json({ error: 'Este lead no tiene email' }, { status: 422 })

  // Mismo bloqueo comercial que el envío masivo, evaluado al enviar.
  // FAIL CLOSED: si la lista de bajas no se puede consultar, no se envía.
  let optedOut: boolean
  try {
    optedOut = await isOptedOut(admin, lead.email)
  } catch (error) {
    if (!(error instanceof OptOutLookupError)) throw error
    console.error('[send-intro] no se pudo verificar la lista de bajas — no se envía', error)
    return NextResponse.json(
      { error: 'No se pudo verificar la lista de bajas. Por seguridad no se envió el email. Intenta de nuevo en unos minutos.' },
      { status: 503 },
    )
  }

  if (optedOut) {
    return NextResponse.json(
      { error: 'Esta dirección está dada de baja de los emails comerciales (unsubscribe, rebote permanente o queja de spam). No se envió nada.' },
      { status: 409 },
    )
  }

  // Sin link de baja no se manda: es requisito legal y de reputación.
  const unsubscribeUrl = buildUnsubscribeUrl(lead.id)
  if (!unsubscribeUrl) {
    console.error('[send-intro] falta UNSUBSCRIBE_SECRET/INTERNAL_JOB_SECRET — no se envía sin link de baja')
    return NextResponse.json({ error: 'Falta configuración del servidor para el link de baja (UNSUBSCRIBE_SECRET)' }, { status: 500 })
  }

  const templateKey = typeof body.template_key === 'string' ? body.template_key : 'crm_intro'
  const template = CRM_EMAIL_CATALOG.find(item => item.key === templateKey)
  if (!template) {
    return NextResponse.json({ error: 'El template seleccionado no está disponible para CRM' }, { status: 422 })
  }

  const companyName = lead.company_name?.trim() || 'tu marca'
  const variables = {
    contact_name: lead.contact_name?.trim() || `equipo de ${companyName}`,
    company_name: companyName,
  }

  const rawSubject = typeof body.subject === 'string' && body.subject.trim()
    ? body.subject.trim()
    : template.defaultSubject
  const subject = applyEmailVariables(rawSubject, variables).replace(/[\r\n]+/g, ' ').slice(0, 180)

  const rawMessage = typeof body.message === 'string' && body.message.trim()
    ? body.message.trim()
    : template.defaultMessage ?? ''
  const message = applyEmailVariables(rawMessage, variables)

  if (!subject) return NextResponse.json({ error: 'El asunto no puede estar vacío' }, { status: 422 })
  if (!message) return NextResponse.json({ error: 'El mensaje no puede estar vacío' }, { status: 422 })

  const html = crmCatalogEmail({
    message,
    buttonLabel: template.defaultButtonLabel,
    buttonUrl: template.defaultButtonUrl,
    unsubscribeUrl,
  })

  // Reserva atómica ANTES de llamar a Resend: dos solicitudes simultáneas no
  // pueden pasar ambas. Es una protección temporal (ventana de 10 min), no una
  // garantía de entrega única: Resend no ofrece clave de idempotencia aquí.
  const claim = await claimLeadSend(admin, params.id, lead.contacted_at ?? null)
  if (!claim.claimed) {
    if (claim.reason === 'error') {
      console.error('[send-intro] no se pudo reservar el envío — no se envía', claim.message)
      return NextResponse.json({ error: 'No se pudo reservar el envío. Por seguridad no se envió el email. Intenta de nuevo en unos minutos.' }, { status: 503 })
    }
    return NextResponse.json(
      { error: `Este lead ya fue contactado hace menos de ${Math.round(SEND_GUARD_WINDOW_MS / 60000)} minutos. No se envió otro email para evitar duplicados.`, code: 'recent_send' },
      { status: 409 },
    )
  }

  let emailData: { id?: string } | null = null
  let emailErr: { name?: string; message?: string } | null = null
  let thrown: unknown = null
  try {
    const result = await getResend().emails.send({
      from: FROM_EMAIL,
      to: lead.email, tags: [emailAudience('crm')],
      subject,
      html,
      text: message,
      headers: commercialEmailHeaders(unsubscribeUrl),
    })
    emailData = result.data
    emailErr = result.error
  } catch (error) {
    thrown = error
  }

  const sentContent = { subject, message, html }

  if (thrown || (emailErr && !isDefinitiveResendFailure(emailErr))) {
    // Resultado AMBIGUO: el correo pudo haberse aceptado. No se libera la
    // reserva ni se reenvía automáticamente; queda registrado para que una
    // persona verifique en Resend antes de reintentar.
    const detail = thrown instanceof Error ? thrown.message : emailErr?.message ?? 'error desconocido'
    console.error('[send-intro] resultado ambiguo de Resend — reserva conservada', { leadId: params.id, detail })
    await admin.from('crm_email_events').insert({
      lead_id: params.id,
      resend_email_id: null,
      event_type: 'email.send_unconfirmed',
      recipient_email: lead.email,
      subject,
      occurred_at: new Date().toISOString(),
      raw_payload: { source: 'send-intro', template_key: template.key, error: detail, ...sentContent },
    })
    await admin.from('crm_lead_activities').insert({
      lead_id: params.id,
      action_type: 'note',
      description: `Envío NO confirmado a ${lead.email} (${template.name}): ${detail}. Verifica en Resend antes de reintentar.`,
      created_by: user.id,
    })
    return NextResponse.json(
      { error: 'No se pudo confirmar si el email salió. No se reintentará automáticamente: revisa Resend antes de volver a enviar.', code: 'send_unconfirmed' },
      { status: 502 },
    )
  }

  if (emailErr) {
    // Rechazo definitivo: el email no salió, se libera la reserva.
    const released = await releaseLeadSend(admin, params.id, claim)
    if (released.error) console.error('[send-intro] no se pudo liberar la reserva', released.error)
    await admin.from('crm_lead_activities').insert({
      lead_id: params.id,
      action_type: 'email_sent',
      description: `Intento de envío falló: ${emailErr.message ?? 'error desconocido'}`,
      created_by: user.id,
    })
    return NextResponse.json({ error: emailErr.message ?? 'Error al enviar email' }, { status: 500 })
  }

  const now = new Date().toISOString()
  const resendEmailId = emailData?.id ?? null

  const leadUpdate: Record<string, unknown> = { contacted_at: now, updated_at: now }
  // Solo avanza a "Contactada" si el lead todavía no entró al pipeline. Un lead
  // en interested/building/converted no retrocede por mandarle otro email.
  if (lead.qualification_status === 'unqualified' || lead.qualification_status === 'qualified') {
    leadUpdate.qualification_status = 'contacted'
  }

  // El email YA salió. Si un registro posterior falla, NO se revierte ni se
  // reenvía: la reserva sigue activa y se deja constancia para resolverlo.
  const writeErrors: string[] = []
  const track = (label: string, error: { message: string } | null) => { if (error) writeErrors.push(`${label}: ${error.message}`) }

  track('crm_leads', (await admin.from('crm_leads').update(leadUpdate).eq('id', params.id)).error)

  track('crm_email_events', (await admin.from('crm_email_events').insert({
    lead_id: params.id,
    resend_email_id: resendEmailId,
    event_type: 'email.sent',
    recipient_email: lead.email,
    subject,
    occurred_at: now,
    raw_payload: {
      source: 'send-intro',
      email_type: template.name,
      template_key: template.key,
      resend_email_id: resendEmailId,
      ...sentContent,
    },
  })).error)

  track('crm_lead_activities', (await admin.from('crm_lead_activities').insert({
    lead_id: params.id,
    action_type: 'email_sent',
    description: `Tipo: ${template.name} · Para: ${lead.email} · Asunto: ${subject}`,
    created_by: user.id,
  })).error)

  if (writeErrors.length > 0) {
    console.error('[send-intro] email enviado pero falló el registro — NO reenviar', { leadId: params.id, resendEmailId, writeErrors })
    // Último intento de dejar al menos una huella con el id de Resend.
    await admin.from('crm_lead_activities').insert({
      lead_id: params.id,
      action_type: 'note',
      description: `Email enviado a ${lead.email} (Resend ${resendEmailId ?? 'sin id'}) pero el registro quedó incompleto. No reenviar.`,
      created_by: user.id,
    })
  }

  return NextResponse.json({
    success: true,
    resend_email_id: resendEmailId,
    subject,
    message,
    ...(writeErrors.length > 0 ? { warning: 'El email salió, pero el registro quedó incompleto. No lo reenvíes.' } : {}),
  })
}
