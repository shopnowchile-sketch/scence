import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getCampaignDateKey, isAttendanceExpirable } from '@/lib/attendance-state'

// Corre a diario. Una falta de respuesta no deja cupos bloqueados indefinidamente.
export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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

  // Solo campañas abiertas: las completed/canceled (incluida la que se acaba de
  // completar arriba) quedan fuera — su historia ya la definió el admin.
  const { data: overdueRows, error } = await admin.from('campaign_deliverables')
    .select('id, status, due_date, attendance_response, campaigns!inner(status)')
    .eq('type', 'event_attendance').is('attendance_response', null).lt('due_date', today)
    .not('campaigns.status', 'in', '(completed,canceled)')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // Segunda barrera en código (misma regla, testeada): no depender solo del filtro del embed.
  const overdue = ((overdueRows ?? []) as unknown as Array<{ id: string; status: string | null; due_date: string | null; attendance_response: string | null; campaigns: { status: string | null } | null }>)
    .filter(row => isAttendanceExpirable({ ...row, campaign_status: row.campaigns?.status ?? null }, now))
  const ids = overdue.map(row => row.id)
  const pendingIds = overdue.filter(row => row.status !== 'rejected').map(row => row.id)
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
  // IMPORTANTE: vencer la confirmación de asistencia NO rechaza la participación
  // de la influencer en la campaña. El entregable de asistencia queda rechazado,
  // pero los demás entregables (Reel/Story/contenido) siguen activos mientras la
  // campaña continúe vigente. application_status es la fuente de verdad de la
  // participación y solo debe cambiar por una decisión explícita de gestión.
  const released = 0

  return NextResponse.json({ ok: true, released, campaigns_completed: completedCampaigns?.length ?? 0 })
}
