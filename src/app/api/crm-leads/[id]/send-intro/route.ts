import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getResend, FROM_EMAIL, crmIntroEmail } from '@/lib/resend'
import { isCrmAdmin } from '@/lib/crm-auth'

type Params = { params: { id: string } }

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function plainTextToHtml(message: string) {
  return `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6; font-size: 15px;">
      ${escapeHtml(message).replace(/\n/g, '<br />')}
    </div>
  `
}

function defaultPlainMessage(lead: { contact_name: string | null; company_name: string | null }) {
  const contactName = lead.contact_name ?? 'equipo'
  const companyName = lead.company_name ?? 'tu marca'

  return `Hola ${contactName},

Soy Priscilla de SCENCE, una plataforma chilena que conecta marcas con creadoras de contenido para campañas, eventos, canjes y contenido UGC.

Vi ${companyName} y creo que podría calzar muy bien con nuestra comunidad.

Estamos invitando a algunas marcas a probar SCENCE con una primera campaña gratuita, para que puedan conocer cómo funciona la plataforma y recibir propuestas de creadoras.

Si te interesa, puedes responder este correo y te cuento los siguientes pasos.

Saludos,
Priscilla
SCENCE`
}

export async function POST(req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  if (!(await isCrmAdmin(user, admin))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({} as { subject?: string; message?: string }))

  const { data: lead, error: leadErr } = await admin
    .from('crm_leads')
    .select('id, contact_name, company_name, email, qualification_status')
    .eq('id', params.id)
    .single()

  if (leadErr || !lead) return NextResponse.json({ error: 'Lead no encontrado' }, { status: 404 })
  if (!lead.email) return NextResponse.json({ error: 'Este lead no tiene email' }, { status: 422 })

  const fallbackSubject = 'Hola, ¿cómo estás?'
  const subject = typeof body.subject === 'string' && body.subject.trim()
    ? body.subject.trim()
    : fallbackSubject

  const customMessage = typeof body.message === 'string' ? body.message.trim() : ''
  const hasCustomMessage = customMessage.length > 0

  if (!subject.trim()) {
    return NextResponse.json({ error: 'El asunto no puede estar vacío' }, { status: 422 })
  }

  const html = hasCustomMessage
    ? plainTextToHtml(customMessage)
    : crmIntroEmail({
        contactName: lead.contact_name ?? 'equipo',
        companyName: lead.company_name ?? lead.email,
      })

  const { data: emailData, error: emailErr } = await getResend().emails.send({
    from: FROM_EMAIL,
    to: lead.email,
    subject,
    html,
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
  if (lead.qualification_status !== 'converted') {
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
      email_type: 'Introducción comercial CRM',
      resend_email_id: resendEmailId,
    },
  })

  await admin.from('crm_lead_activities').insert({
    lead_id: params.id,
    action_type: 'email_sent',
    description: `Tipo: Introducción comercial CRM · Para: ${lead.email} · Asunto: ${subject}`,
    created_by: user.id,
  })

  return NextResponse.json({
    success: true,
    resend_email_id: resendEmailId,
    subject,
    message: hasCustomMessage ? customMessage : defaultPlainMessage(lead),
  })
}
