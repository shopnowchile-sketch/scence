import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getResend, FROM_EMAIL, crmCatalogEmail } from '@/lib/resend'
import { isCrmAdmin } from '@/lib/crm-auth'
import { applyEmailVariables, CRM_EMAIL_CATALOG } from '@/lib/email-catalog'

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
    .select('id, contact_name, company_name, email, qualification_status')
    .eq('id', params.id)
    .single()

  if (leadErr || !lead) return NextResponse.json({ error: 'Lead no encontrado' }, { status: 404 })
  if (!lead.email) return NextResponse.json({ error: 'Este lead no tiene email' }, { status: 422 })

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
  })

  const { data: emailData, error: emailErr } = await getResend().emails.send({
    from: FROM_EMAIL,
    to: lead.email,
    subject,
    html,
    text: message,
  })

  if (emailErr) {
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

  await admin.from('crm_leads').update(leadUpdate).eq('id', params.id)

  await admin.from('crm_email_events').insert({
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
    },
  })

  await admin.from('crm_lead_activities').insert({
    lead_id: params.id,
    action_type: 'email_sent',
    description: `Tipo: ${template.name} · Para: ${lead.email} · Asunto: ${subject}`,
    created_by: user.id,
  })

  return NextResponse.json({
    success: true,
    resend_email_id: resendEmailId,
    subject,
    message,
  })
}
