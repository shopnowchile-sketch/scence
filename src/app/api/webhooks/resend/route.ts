import { NextRequest, NextResponse } from 'next/server'
import { Webhook } from 'svix'
import { createAdminClient } from '@/lib/supabase/server'

type ResendWebhookPayload = {
  type?: string
  created_at?: string
  data?: {
    email_id?: string
    id?: string
    to?: string | string[]
    from?: string
    subject?: string
    click?: { link?: string }
    [key: string]: unknown
  }
  [key: string]: unknown
}

const EVENT_LABEL: Record<string, string> = {
  'email.sent': 'Email enviado',
  'email.delivered': 'Email entregado',
  'email.delivery_delayed': 'Entrega demorada',
  'email.opened': 'Email abierto',
  'email.clicked': 'Link clickeado',
  'email.bounced': 'Email rebotado',
  'email.complained': 'Marcado como spam',
  'email.failed': 'Falló el email',
  'email.suppressed': 'Email suprimido',
}

function firstEmail(value: unknown): string | null {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : null
  return typeof value === 'string' ? value : null
}

export async function POST(req: NextRequest) {
  const payload = await req.text()
  const secret = process.env.RESEND_WEBHOOK_SECRET

  if (!secret) {
    console.error('[Resend webhook] Falta RESEND_WEBHOOK_SECRET')
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }

  let event: ResendWebhookPayload

  try {
    const wh = new Webhook(secret)
    event = wh.verify(payload, {
      'svix-id': req.headers.get('svix-id') ?? '',
      'svix-timestamp': req.headers.get('svix-timestamp') ?? '',
      'svix-signature': req.headers.get('svix-signature') ?? '',
    }) as ResendWebhookPayload
  } catch (error) {
    console.error('[Resend webhook] Firma inválida', error)
    return NextResponse.json({ error: 'Invalid webhook' }, { status: 400 })
  }

  const admin = createAdminClient()
  const eventType = event.type ?? 'unknown'
  const data = event.data ?? {}
  const resendEmailId = data.email_id ?? data.id ?? null
  const recipientEmail = firstEmail(data.to)
  const subject = typeof data.subject === 'string' ? data.subject : null
  const occurredAt = event.created_at ?? new Date().toISOString()

  let leadId: string | null = null

  if (resendEmailId) {
    const { data: existing } = await admin
      .from('crm_email_events')
      .select('lead_id')
      .eq('resend_email_id', resendEmailId)
      .not('lead_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    leadId = existing?.lead_id ?? null
  }

  if (!leadId && recipientEmail) {
    const { data: lead } = await admin
      .from('crm_leads')
      .select('id')
      .ilike('email', recipientEmail)
      .limit(1)
      .maybeSingle()

    leadId = lead?.id ?? null
  }

  await admin.from('crm_email_events').insert({
    lead_id: leadId,
    resend_email_id: resendEmailId,
    event_type: eventType,
    recipient_email: recipientEmail,
    subject,
    occurred_at: occurredAt,
    raw_payload: event,
  })

  if (leadId) {
    const label = EVENT_LABEL[eventType] ?? eventType
    const clickedLink = eventType === 'email.clicked' && data.click && typeof data.click.link === 'string'
      ? ` · Link: ${data.click.link}`
      : ''

    await admin.from('crm_lead_activities').insert({
      lead_id: leadId,
      action_type: 'email_sent',
      description: `${label}${recipientEmail ? ` · ${recipientEmail}` : ''}${subject ? ` · Asunto: ${subject}` : ''}${clickedLink}`,
      created_by: null,
    })
  }

  return NextResponse.json({ received: true })
}
