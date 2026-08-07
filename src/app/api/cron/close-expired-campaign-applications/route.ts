import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

// Cierra el ciclo sin borrar el historial: las pendientes pasan a rechazadas
// cuando vence la fecha de postulación.
export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const now = new Date().toISOString()
  const { data: campaigns, error } = await admin.from('campaigns').select('id').eq('status', 'active').not('application_deadline', 'is', null).lt('application_deadline', now).is('applications_closed_at', null)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const ids = (campaigns ?? []).map(c => c.id)
  if (!ids.length) return NextResponse.json({ ok: true, closed: 0, rejected: 0 })
  const { data: pending } = await admin.from('campaign_influencers').select('id').in('campaign_id', ids).eq('application_status', 'pending').eq('origin', 'application')
  const pendingIds = (pending ?? []).map(row => row.id)
  if (pendingIds.length) await admin.from('campaign_influencers').update({ application_status: 'rejected', status: 'inactive', notes: 'Postulación cerrada automáticamente al vencer la fecha límite.', updated_at: now }).in('id', pendingIds)
  await admin.from('campaigns').update({ applications_closed_at: now, updated_at: now }).in('id', ids)
  return NextResponse.json({ ok: true, closed: ids.length, rejected: pendingIds.length })
}
