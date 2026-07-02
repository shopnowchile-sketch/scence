import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getResend, FROM_EMAIL, crmIntroEmail } from '@/lib/resend'

type Params = { params: { id: string } }

async function isAdminUser(userId: string, admin: ReturnType<typeof createAdminClient>) {
  const { data } = await admin.from('profiles').select('role').eq('id', userId).maybeSingle()
  return ['super_admin', 'brand_manager'].includes(String(data?.role ?? ''))
}

// ── POST /api/crm-leads/[id]/send-intro — email de presentación + primera campaña gratis ──
export async function POST(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  if (!(await isAdminUser(user.id, admin))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: lead, error: leadErr } = await admin
    .from('crm_leads')
    .select('id, contact_name, company_name, email')
    .eq('id', params.id)
    .single()

  if (leadErr || !lead) return NextResponse.json({ error: 'Lead no encontrado' }, { status: 404 })
  if (!lead.email) return NextResponse.json({ error: 'Este lead no tiene email' }, { status: 422 })

  const { error: emailErr } = await getResend().emails.send({
    from: FROM_EMAIL,
    to: lead.email,
    subject: `${lead.company_name ?? 'Hola'} — conoce Scence (primera campaña gratis)`,
    html: crmIntroEmail({
      contactName: lead.contact_name ?? 'equipo',
      companyName: lead.company_name ?? lead.email,
    }),
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
  await admin.from('crm_leads').update({ contacted_at: now, updated_at: now }).eq('id', params.id)
  await admin.from('crm_lead_activities').insert({
    lead_id: params.id,
    action_type: 'email_sent',
    description: `Email de presentación enviado a ${lead.email}`,
    created_by: user.id,
  })

  return NextResponse.json({ success: true })
}
