import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { authorizeCampaignBrandAction } from '@/lib/campaign-brand-access'
import { FROM_EMAIL, getResend } from '@/lib/resend'
import { getCampaignDateKey } from '@/lib/attendance-state'

type Params = { params: { id: string } }
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'

function mailHtml(name: string, campaign: string, campaignId: string, dueDate: string, message?: string) {
  return `<!doctype html><html><body style="margin:0;background:#f7f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1f2937"><div style="max-width:540px;margin:32px auto;background:#fff;border-radius:18px;overflow:hidden"><div style="padding:28px;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff"><div style="font-size:28px">✋</div><b style="font-size:20px">Confirma tu asistencia</b></div><div style="padding:28px"><p>Hola ${name},</p><p>Te necesitamos para confirmar si asistirás a <b>${campaign}</b>.</p>${message ? `<div style="padding:14px;border-radius:10px;background:#f5f3ff">${message}</div>` : ''}<p><b>Fecha límite:</b> ${dueDate}</p><p style="padding:12px;border-radius:10px;background:#fff7ed;color:#9a3412"><b>Importante:</b> si no confirmas dentro del plazo, tu cupo se liberará para poder invitar a otra creadora.</p><a href="${APP_URL}/inf-campaign/${campaignId}" style="display:block;padding:14px;border-radius:10px;background:#7c3aed;color:#fff;text-align:center;font-weight:700;text-decoration:none">Confirmar en Scence</a><p style="font-size:12px;color:#6b7280">Responde Sí, asistiré o No podré asistir. Tu respuesta ayuda a organizar la experiencia.</p></div></div></body></html>`
}

async function canManage(admin: ReturnType<typeof createAdminClient>, user: { id: string; user_metadata?: Record<string, unknown> }, campaignId: string) {
  const { data: campaign } = await admin.from('campaigns').select('id, organization_id, brand_id, created_by_brand_id').eq('id', campaignId).maybeSingle()
  if (!campaign) return { allowed: false, campaign: null }
  const access = await authorizeCampaignBrandAction(user.id, campaignId, 'application.manage')
  return { allowed: !!access, campaign }
}

export async function POST(request: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => ({})) as { action?: 'remind'; due_date?: string; message?: string; send_email?: boolean; influencer_ids?: string[] }
  const admin = createAdminClient()
  const access = await canManage(admin, user, params.id)
  if (!access.allowed) return NextResponse.json({ error: 'No tienes permiso para gestionar esta campaña.' }, { status: 403 })
  const { data: campaign } = await admin.from('campaigns').select('id, name, deliverable_templates').eq('id', params.id).single()
  if (!campaign) return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })

  if (body.action === 'remind') {
    const ids = Array.from(new Set((body.influencer_ids ?? []).filter(Boolean)))
    if (!ids.length) return NextResponse.json({ error: 'Selecciona al menos una influencer pendiente.' }, { status: 422 })
    const { data: rows, error } = await admin
      .from('campaign_deliverables')
      .select('influencer_id, due_date, description, influencer:influencers(display_name,email)')
      .eq('campaign_id', params.id)
      .eq('type', 'event_attendance')
      .eq('status', 'pending')
      .is('attendance_response', null)
      .gte('due_date', getCampaignDateKey())
      .in('influencer_id', ids)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const people = (rows ?? []).map(row => ({
      name: (row.influencer as unknown as { display_name?: string | null })?.display_name ?? 'Hola',
      email: (row.influencer as unknown as { email?: string | null })?.email,
      dueDate: row.due_date,
      message: row.description ?? undefined,
    })).filter(person => !!person.email && !!person.dueDate)
    if (!people.length) return NextResponse.json({ error: 'No hay confirmaciones pendientes con email disponible.' }, { status: 422 })
    const result = await getResend().batch.send(people.map(person => {
      const dueLabel = new Date(`${person.dueDate}T12:00:00`).toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })
      return { from: FROM_EMAIL, to: person.email!, subject: `Recordatorio: confirma tu asistencia antes del ${dueLabel}`, html: mailHtml(person.name, campaign.name, params.id, dueLabel, person.message) }
    }))
    if (result.error) return NextResponse.json({ error: 'No se pudo enviar el recordatorio.' }, { status: 500 })
    return NextResponse.json({ data: { sent: people.length } })
  }

  if (!body.due_date || !/^\d{4}-\d{2}-\d{2}$/.test(body.due_date)) return NextResponse.json({ error: 'Define una fecha límite para confirmar.' }, { status: 422 })

  const { data: accepted, error: acceptedError } = await admin.from('campaign_influencers').select('id, influencer_id, influencer:influencers(display_name,email)').eq('campaign_id', params.id).eq('application_status', 'accepted')
  if (acceptedError) return NextResponse.json({ error: acceptedError.message }, { status: 500 })
  if (!accepted?.length) return NextResponse.json({ error: 'Aún no hay influencers aceptadas.' }, { status: 422 })
  const influencerIds = accepted.map(row => row.influencer_id)
  const { data: existing } = await admin.from('campaign_deliverables').select('id, influencer_id, status, attendance_response').eq('campaign_id', params.id).eq('type', 'event_attendance').in('influencer_id', influencerIds)
  const existingIds = new Set((existing ?? []).map(row => row.influencer_id))
  const newRows = accepted.filter(row => !existingIds.has(row.influencer_id)).map(row => ({
    campaign_id: params.id, campaign_influencer_id: row.id, influencer_id: row.influencer_id,
    type: 'event_attendance', title: 'Confirmar asistencia', description: body.message?.trim() || null,
    due_date: body.due_date, quantity: 1, status: 'pending',
  }))
  if (newRows.length) {
    const { error } = await admin.from('campaign_deliverables').insert(newRows)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  const pendingExistingIds = (existing ?? []).filter(row => row.status === 'pending' && !row.attendance_response).map(row => row.id)
  if (pendingExistingIds.length) {
    const update: Record<string, string | null> = { due_date: body.due_date }
    if (body.message !== undefined) update.description = body.message.trim() || null
    const { error } = await admin.from('campaign_deliverables').update(update).in('id', pendingExistingIds)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Deja una plantilla para las próximas influencers que se aprueben.
  const templates = Array.isArray(campaign.deliverable_templates) ? campaign.deliverable_templates as Array<Record<string, unknown>> : []
  const nextTemplate = { type: 'event_attendance', title: 'Confirmar asistencia', description: body.message?.trim() || '', due_date: body.due_date, quantity: 1 }
  const mergedTemplates = templates.some(template => template.type === 'event_attendance')
    ? templates.map(template => template.type === 'event_attendance' ? nextTemplate : template)
    : [...templates, nextTemplate]
  await admin.from('campaigns').update({ deliverable_templates: mergedTemplates }).eq('id', params.id)

  let emailed = 0
  if (body.send_email !== false && (newRows.length || pendingExistingIds.length)) {
    const recipients = new Set([...newRows.map(row => row.influencer_id), ...(existing ?? []).filter(row => pendingExistingIds.includes(row.id)).map(row => row.influencer_id)])
    const people = accepted.filter(row => recipients.has(row.influencer_id)).map(row => ({
      name: (row.influencer as unknown as { display_name?: string | null })?.display_name ?? 'Hola',
      email: (row.influencer as unknown as { email?: string | null })?.email,
    })).filter(person => !!person.email)
    const dueLabel = new Date(`${body.due_date}T12:00:00`).toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })
    if (people.length) {
      const result = await getResend().batch.send(people.map(person => ({ from: FROM_EMAIL, to: person.email!, subject: `Confirma tu asistencia antes del ${dueLabel}`, html: mailHtml(person.name, campaign.name, params.id, dueLabel, body.message?.trim()) })))
      if (!result.error) emailed = people.length
    }
  }
  return NextResponse.json({ data: { created: newRows.length, updated: pendingExistingIds.length, existing: existingIds.size, emailed } })
}
