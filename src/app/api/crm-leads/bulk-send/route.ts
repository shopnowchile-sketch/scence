import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getResend, FROM_EMAIL, crmIntroEmail } from '@/lib/resend'

async function isAdminUser(userId: string, admin: ReturnType<typeof createAdminClient>) {
  const { data } = await admin.from('profiles').select('role').eq('id', userId).maybeSingle()
  return ['super_admin', 'brand_manager'].includes(String(data?.role ?? ''))
}

function defaultPlainMessage(lead: { contact_name: string | null; company_name: string | null }) {
  const name = lead.contact_name?.trim() || 'hola'
  const companyName = lead.company_name ?? 'tu marca'

  return `Hola ${name},

Soy Priscilla de SCENCE. Estamos conectando marcas chilenas con creadoras de contenido para campañas, eventos, canjes y UGC.

Vi ${companyName} y creo que podría calzar muy bien para probar una primera campaña con creadoras.

¿Te gustaría que te enviemos más información?

Saludos,
Priscilla
SCENCE`
}

export async function POST(request: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  if (!(await isAdminUser(user.id, admin))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const leadIds = Array.isArray(body.lead_ids)
    ? body.lead_ids.filter((id: unknown) => typeof id === 'string' && id.length > 0)
    : []

  const uniqueIds = Array.from(new Set(leadIds))

  if (uniqueIds.length === 0) {
    return NextResponse.json({ error: 'No hay leads seleccionados' }, { status: 422 })
  }

  if (uniqueIds.length > 50) {
    return NextResponse.json({ error: 'Máximo 50 emails por envío masivo' }, { status: 422 })
  }

  const subject = typeof body.subject === 'string' && body.subject.trim()
    ? body.subject.trim()
    : 'Hola, ¿cómo estás?'

  const customMessage = typeof body.message === 'string' && body.message.trim()
    ? body.message.trim()
    : ''

  const { data: leads, error: leadsError } = await admin
    .from('crm_leads')
    .select('id, contact_name, company_name, email, qualification_status')
    .in('id', uniqueIds)

  if (leadsError) {
    console.error('[POST /api/crm-leads/bulk-send]', leadsError)
    return NextResponse.json({ error: leadsError.message }, { status: 500 })
  }

  let sent = 0
  let skipped = 0
  let failed = 0

  for (const lead of leads ?? []) {
    if (!lead.email) {
      skipped++
      continue
    }

    const message = customMessage || defaultPlainMessage(lead)
    const html = customMessage
      ? `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;white-space:pre-wrap">${message}</div>`
      : crmIntroEmail({
          contactName: lead.contact_name,
          companyName: lead.company_name ?? lead.email,
        })

    const { data: emailData, error: emailError } = await getResend().emails.send({
      from: FROM_EMAIL,
      to: lead.email,
      subject,
      html,
      text: message,
    })

    const now = new Date().toISOString()
    const resendEmailId = emailData?.id ?? null

    if (emailError) {
      failed++
      await admin.from('crm_lead_activities').insert({
        lead_id: lead.id,
        action_type: 'email_sent',
        description: `Envío masivo falló a ${lead.email}: ${emailError.message ?? 'error desconocido'}`,
        created_by: user.id,
      })
      continue
    }

    sent++

    await admin.from('crm_email_events').insert({
      lead_id: lead.id,
      resend_email_id: resendEmailId,
      event_type: 'email.sent',
      recipient_email: lead.email,
      subject,
      raw_payload: { source: 'bulk-send', resend_email_id: resendEmailId },
    })

    await admin.from('crm_leads').update({
      contacted_at: now,
      updated_at: now,
      qualification_status: lead.qualification_status === 'converted' ? 'converted' : 'contacted',
    }).eq('id', lead.id)

    await admin.from('crm_lead_activities').insert({
      lead_id: lead.id,
      action_type: 'email_sent',
      description: `Email masivo enviado a ${lead.email} · Asunto: ${subject}${resendEmailId ? ` · Resend ID: ${resendEmailId}` : ''}`,
      created_by: user.id,
    })

    await new Promise(resolve => setTimeout(resolve, 150))
  }

  return NextResponse.json({
    sent,
    skipped,
    failed,
    requested: uniqueIds.length,
  })
}
