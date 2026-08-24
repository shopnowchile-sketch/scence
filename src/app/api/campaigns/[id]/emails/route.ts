import { NextRequest, NextResponse } from 'next/server'
import { authorizeCampaignBrandAction } from '@/lib/campaign-brand-access'
import { createServerClient } from '@/lib/supabase/server'
import { applyEmailVariables, CAMPAIGN_EMAIL_CATALOG, getEmailTemplate } from '@/lib/email-catalog'
import {
  attendanceConfirmationEmail,
  attendanceReminderEmail,
  campaignAssignedEmail,
  campaignCustomMessageEmail,
  deliverableReminderEmail,
  FROM_EMAIL,
  getResend,
} from '@/lib/resend'
import { isDeliverableComplete } from '@/lib/deliverable-status'

type Params = { params: { id: string } }
type RequestBody = {
  action?: 'preview' | 'send'
  template_key?: string
  influencer_ids?: string[]
  subject?: string
  message?: string
  action_url?: string
  button_label?: string
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
    .replaceAll('\n', '<br>')
}

function safeActionUrl(value: string | undefined, fallback: string): string | null {
  if (!value?.trim()) return fallback
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

export async function GET(_request: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await authorizeCampaignBrandAction(user.id, params.id, 'influencer.manage'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return NextResponse.json({ data: CAMPAIGN_EMAIL_CATALOG })
}

export async function POST(request: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const access = await authorizeCampaignBrandAction(user.id, params.id, 'influencer.manage')
  if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => null) as RequestBody | null
  if (!body || (body.action !== 'preview' && body.action !== 'send')) {
    return NextResponse.json({ error: 'Acción inválida.' }, { status: 422 })
  }

  const template = body.template_key ? getEmailTemplate(body.template_key) : undefined
  if (!template || !CAMPAIGN_EMAIL_CATALOG.some(item => item.key === template.key)) {
    return NextResponse.json({ error: 'Template no disponible para campañas.' }, { status: 422 })
  }

  const influencerIds = Array.from(new Set((body.influencer_ids ?? []).filter(id => typeof id === 'string' && id.length > 0)))
  if (!influencerIds.length) return NextResponse.json({ error: 'Selecciona al menos una influencer aceptada.' }, { status: 422 })

  const { admin } = access
  const [{ data: campaign, error: campaignError }, { data: relations, error: relationsError }] = await Promise.all([
    admin.from('campaigns').select('id, name, type, brand:brands!brand_id(name)').eq('id', params.id).single(),
    admin.from('campaign_influencers')
      .select('id, influencer_id, application_status, influencer:influencers(id, display_name, email)')
      .eq('campaign_id', params.id)
      .eq('application_status', 'accepted')
      .in('influencer_id', influencerIds),
  ])
  if (campaignError || !campaign) return NextResponse.json({ error: 'Campaña no encontrada.' }, { status: 404 })
  if (relationsError) return NextResponse.json({ error: relationsError.message }, { status: 500 })

  const relationByInfluencer = new Map((relations ?? []).map(relation => [relation.influencer_id, relation]))
  if (influencerIds.some(influencerId => !relationByInfluencer.has(influencerId))) {
    return NextResponse.json({ error: 'Una o más influencers no pertenecen a esta campaña o no están aceptadas.' }, { status: 422 })
  }

  const recipients = (relations ?? []).map(relation => {
    const influencer = relation.influencer as unknown as { id: string; display_name: string | null; email: string | null } | null
    return { id: relation.influencer_id, name: influencer?.display_name || 'Influencer', email: influencer?.email || null }
  })
  if (body.action === 'send' && recipients.some(recipient => !recipient.email)) {
    return NextResponse.json({ error: 'Una o más influencers seleccionadas no tienen email registrado.' }, { status: 422 })
  }

  const { data: deliverables, error: deliverablesError } = await admin.from('campaign_deliverables')
    .select('influencer_id, title, type, status, due_date, content_url, published_url, attendance_response')
    .eq('campaign_id', params.id)
    .in('influencer_id', influencerIds)
  if (deliverablesError) return NextResponse.json({ error: deliverablesError.message }, { status: 500 })

  const portalUrl = `${APP_URL}/inf-campaign/${params.id}`
  const actionUrl = safeActionUrl(body.action_url, portalUrl)
  if (!actionUrl) return NextResponse.json({ error: 'El link debe comenzar con http:// o https://.' }, { status: 422 })

  const cleanMessage = escapeHtml((body.message ?? template.defaultMessage ?? '').trim().slice(0, 5000))
  const cleanButtonLabel = escapeHtml((body.button_label ?? template.defaultButtonLabel ?? 'Ver campaña →').trim().slice(0, 80))
  const subjectTemplate = (body.subject?.trim() || template.defaultSubject).replace(/[\r\n]+/g, ' ').slice(0, 180)
  const brandName = (campaign.brand as unknown as { name?: string | null } | null)?.name ?? 'Scence'

  const rendered = recipients.map(recipient => {
    const recipientDeliverables = (deliverables ?? []).filter(deliverable => deliverable.influencer_id === recipient.id)
    const attendance = recipientDeliverables.find(deliverable => deliverable.type === 'event_attendance')
    const dueLabel = attendance?.due_date
      ? new Date(`${attendance.due_date}T12:00:00`).toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })
      : 'la fecha indicada en tu portal'
    const pendingTitles = recipientDeliverables
      .filter(deliverable => deliverable.type !== 'event_attendance' && !isDeliverableComplete(deliverable))
      .map(deliverable => escapeHtml(deliverable.title || deliverable.type || 'Entregable'))
    const variables = {
      influencer_name: recipient.name,
      campaign_name: campaign.name,
      brand_name: brandName,
      attendance_deadline: dueLabel,
      portal_url: actionUrl,
      pending_deliverables: pendingTitles.join(', '),
    }
    const subject = applyEmailVariables(subjectTemplate, variables)
    const safeRecipientName = escapeHtml(recipient.name)
    const safeCampaignName = escapeHtml(campaign.name)
    let html: string
    if (template.key === 'attendance_confirmation') {
      html = attendanceConfirmationEmail({ influencerName: safeRecipientName, campaignName: safeCampaignName, campaignId: params.id, dueDate: attendance?.due_date, message: cleanMessage, actionUrl, buttonLabel: cleanButtonLabel })
    } else if (template.key === 'attendance_reminder') {
      html = attendanceReminderEmail({ influencerName: safeRecipientName, campaignName: safeCampaignName, campaignId: params.id, dueDate: dueLabel, message: cleanMessage, actionUrl, buttonLabel: cleanButtonLabel })
    } else if (template.key === 'campaign_content_reminder') {
      html = deliverableReminderEmail({ influencerName: safeRecipientName, campaignName: safeCampaignName, pendingTitles: pendingTitles.length ? pendingTitles : ['Revisa tus entregables en el portal'], appUrl: actionUrl, message: cleanMessage, buttonLabel: cleanButtonLabel })
    } else if (template.key === 'campaign_assignment') {
      html = campaignAssignedEmail({ influencerName: safeRecipientName, campaignName: safeCampaignName, campaignType: campaign.type, campaignUrl: actionUrl, message: cleanMessage, buttonLabel: cleanButtonLabel })
    } else {
      html = campaignCustomMessageEmail({ influencerName: safeRecipientName, campaignName: safeCampaignName, message: cleanMessage, actionUrl, buttonLabel: cleanButtonLabel })
    }
    return { ...recipient, subject, html }
  })

  if (body.action === 'preview') {
    return NextResponse.json({ data: { subject: rendered[0].subject, html: rendered[0].html, recipient_name: rendered[0].name } })
  }

  let sent = 0
  for (let index = 0; index < rendered.length; index += 100) {
    const chunk = rendered.slice(index, index + 100)
    const result = await getResend().batch.send(chunk.map(email => ({ from: FROM_EMAIL, to: email.email!, subject: email.subject, html: email.html })))
    if (result.error) return NextResponse.json({ error: `No se pudo completar el envío. Se enviaron ${sent} de ${rendered.length}.` }, { status: 502 })
    sent += chunk.length
  }
  return NextResponse.json({ data: { sent } })
}
