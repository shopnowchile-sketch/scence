import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { authorizeCampaignBrandAction } from '@/lib/campaign-brand-access'
import { attendanceReminderEmail, FROM_EMAIL, getResend } from '@/lib/resend'
import { getCampaignDateKey } from '@/lib/attendance-state'

type Params = { params: { id: string } }
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
      return { from: FROM_EMAIL, to: person.email!, subject: `Recordatorio: confirma tu asistencia antes del ${dueLabel}`, html: attendanceReminderEmail({ influencerName: person.name, campaignName: campaign.name, campaignId: params.id, dueDate: dueLabel, message: person.message }) }
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
      const result = await getResend().batch.send(people.map(person => ({ from: FROM_EMAIL, to: person.email!, subject: `Confirma tu asistencia antes del ${dueLabel}`, html: attendanceReminderEmail({ influencerName: person.name, campaignName: campaign.name, campaignId: params.id, dueDate: dueLabel, message: body.message?.trim() }) })))
      if (!result.error) emailed = people.length
    }
  }
  return NextResponse.json({ data: { created: newRows.length, updated: pendingExistingIds.length, existing: existingIds.size, emailed } })
}
