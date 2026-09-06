import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { isAttendanceDeadlineExpired } from '@/lib/attendance-state'

type Params = { params: { id: string } }

// La respuesta de asistencia es deliberadamente separada de /submit: no hay
// URL ni revisión editorial, solo una decisión explícita de la influencer.
export async function POST(request: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => ({})) as { response?: string; note?: string }
  if (body.response !== 'confirmed' && body.response !== 'declined') {
    return NextResponse.json({ error: 'Elige si asistirás o no podrás asistir.' }, { status: 422 })
  }

  const admin = createAdminClient()
  const [{ data: influencer }, { data: deliverable }] = await Promise.all([
    admin.from('influencers').select('id').eq('user_id', user.id).maybeSingle(),
    admin.from('campaign_deliverables').select('id, influencer_id, campaign_id, type, due_date').eq('id', params.id).maybeSingle(),
  ])
  if (!influencer || !deliverable) return NextResponse.json({ error: 'Entregable no encontrado' }, { status: 404 })
  if (deliverable.influencer_id !== influencer.id) return NextResponse.json({ error: 'No tienes acceso a este entregable' }, { status: 403 })

  // Solo una influencer ACEPTADA en la campaña puede accionar sus entregables.
  // Una postulación pendiente o rechazada conserva la fila del entregable pero
  // no puede usarla: esconder el botón en el frontend no protege el endpoint.
  const { data: relation } = await admin
    .from('campaign_influencers')
    .select('application_status')
    .eq('campaign_id', deliverable.campaign_id)
    .eq('influencer_id', influencer.id)
    .maybeSingle()
  if (relation?.application_status !== 'accepted') {
    return NextResponse.json(
      { error: 'Tu participación en esta campaña aún no está aprobada.', code: 'APPLICATION_NOT_ACCEPTED' },
      { status: 403 },
    )
  }
  if (deliverable.type !== 'event_attendance') return NextResponse.json({ error: 'Este entregable no es una confirmación de asistencia' }, { status: 422 })
  if (isAttendanceDeadlineExpired(deliverable.due_date)) {
    return NextResponse.json({ error: 'El plazo para confirmar ya venció y el cupo fue liberado.' }, { status: 422 })
  }

  const { data, error } = await admin.from('campaign_deliverables').update({
    status: body.response === 'confirmed' ? 'approved' : 'rejected',
    attendance_response: body.response,
    attendance_note: body.note?.trim() || null,
    attendance_responded_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', params.id).select('id, attendance_response, attendance_responded_at, attendance_note').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}
