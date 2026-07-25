import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

// Corre a diario. Una falta de respuesta no deja cupos bloqueados indefinidamente.
export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)
  const { data: overdue, error } = await admin.from('campaign_deliverables')
    .select('id, campaign_influencer_id')
    .eq('type', 'event_attendance').eq('status', 'pending').is('attendance_response', null).lt('due_date', today)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const ids = (overdue ?? []).map(row => row.id)
  const assignmentIds = (overdue ?? []).map(row => row.campaign_influencer_id).filter((id): id is string => !!id)
  if (ids.length) await admin.from('campaign_deliverables').update({ status: 'rejected', review_notes: 'Sin respuesta antes de la fecha límite.', updated_at: new Date().toISOString() }).in('id', ids)
  if (assignmentIds.length) await admin.from('campaign_influencers').update({ application_status: 'rejected', status: 'inactive', updated_at: new Date().toISOString() }).in('id', assignmentIds).eq('application_status', 'accepted')
  return NextResponse.json({ ok: true, released: assignmentIds.length })
}
