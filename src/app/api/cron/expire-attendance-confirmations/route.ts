import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getCampaignDateKey } from '@/lib/attendance-state'

// Corre a diario. Una falta de respuesta no deja cupos bloqueados indefinidamente.
export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const now = new Date()
  const today = getCampaignDateKey(now)

  // La fecha de término es la fuente de verdad para cerrar campañas. Reutilizar
  // este cron evita mantener campañas vencidas visibles como oportunidades.
  const { data: completedCampaigns, error: campaignsError } = await admin
    .from('campaigns')
    .update({ status: 'completed', updated_at: now.toISOString() })
    .eq('status', 'active')
    .lt('end_date', today)
    .select('id')
  if (campaignsError) return NextResponse.json({ error: campaignsError.message }, { status: 500 })

  const { data: overdue, error } = await admin.from('campaign_deliverables')
    .select('id, status')
    .eq('type', 'event_attendance').is('attendance_response', null).lt('due_date', today)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const ids = (overdue ?? []).map(row => row.id)
  const pendingIds = (overdue ?? []).filter(row => row.status !== 'rejected').map(row => row.id)
  if (pendingIds.length) {
    const { error: deliverablesError } = await admin.from('campaign_deliverables').update({
      status: 'rejected',
      review_notes: 'Sin respuesta antes de la fecha límite.',
      updated_at: now.toISOString(),
    }).in('id', pendingIds).is('attendance_response', null)
    if (deliverablesError) return NextResponse.json({ error: deliverablesError.message }, { status: 500 })
  }

  // Releer antes de liberar el cupo mantiene la condición a nivel de
  // persistencia: una respuesta que aparezca durante el cron queda excluida.
  const { data: stillOverdue, error: stillOverdueError } = ids.length
    ? await admin.from('campaign_deliverables').select('campaign_influencer_id')
      .in('id', ids).is('attendance_response', null).lt('due_date', today)
    : { data: [], error: null }
  if (stillOverdueError) return NextResponse.json({ error: stillOverdueError.message }, { status: 500 })
  const assignmentIds = Array.from(new Set((stillOverdue ?? []).map(row => row.campaign_influencer_id).filter((id): id is string => !!id)))

  let released = 0
  if (assignmentIds.length) {
    const { data: assignments, error: assignmentsError } = await admin.from('campaign_influencers')
      .select('id, metadata')
      .in('id', assignmentIds)
      .eq('application_status', 'accepted')
    if (assignmentsError) return NextResponse.json({ error: assignmentsError.message }, { status: 500 })

    for (const assignment of assignments ?? []) {
      const metadata = {
        ...((assignment.metadata as Record<string, unknown> | null) ?? {}),
        removal_reason: 'attendance_deadline_closed',
        removal_message: 'Lo sentimos, no confirmaste tu asistencia antes de la fecha límite y los cupos se cerraron.',
        removed_at: now.toISOString(),
      }
      const { data: updated, error: updateError } = await admin.from('campaign_influencers').update({
        application_status: 'rejected',
        status: 'canceled',
        metadata,
        updated_at: now.toISOString(),
      }).eq('id', assignment.id).eq('application_status', 'accepted').select('id').maybeSingle()
      if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
      if (updated) released += 1
    }
  }
  return NextResponse.json({ ok: true, released, campaigns_completed: completedCampaigns?.length ?? 0 })
}
