import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getInfluencerProStatuses } from '@/lib/influencer-pro'

// Cierra el ciclo sin borrar el historial: las pendientes pasan a rechazadas
// cuando vence la fecha de postulación.
export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const now = new Date().toISOString()
  const { data: campaigns, error } = await admin.from('campaigns').select('id').eq('status', 'active').not('application_deadline', 'is', null).lt('application_deadline', now).is('applications_closed_at', null)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const ids = (campaigns ?? []).map(c => c.id)
  let pendingIds: string[] = []
  if (ids.length) {
    const { data: pending } = await admin.from('campaign_influencers').select('id').in('campaign_id', ids).eq('application_status', 'pending').eq('origin', 'application')
    pendingIds = (pending ?? []).map(row => row.id)
    if (pendingIds.length) await admin.from('campaign_influencers').update({ application_status: 'rejected', status: 'inactive', notes: 'Postulación cerrada automáticamente al vencer la fecha límite.', updated_at: now }).in('id', pendingIds)
    await admin.from('campaigns').update({ applications_closed_at: now, updated_at: now }).in('id', ids)
  }

  // Plan Pro vencido durante el proceso: una postulación (origin='application',
  // nunca invitación — ver /api/influencer/campaigns/[id]/apply) a campaña
  // PRIVADA solo pudo crearse con Pro activo. Si la influencer ya no tiene Pro
  // mientras sigue pending o accepted en una campaña todavía activa, queda
  // rechazada — mismo patrón sin borrar historial ni entregables ya creados.
  const { data: privateRows } = await admin
    .from('campaign_influencers')
    .select('id, influencer_id, campaigns!inner(visibility, status)')
    .eq('origin', 'application')
    .in('application_status', ['pending', 'accepted'])
    .eq('campaigns.visibility', 'private')
    .eq('campaigns.status', 'active')

  const rows = (privateRows ?? []) as unknown as Array<{ id: string; influencer_id: string }>
  let proExpiredIds: string[] = []
  if (rows.length) {
    const proStatuses = await getInfluencerProStatuses(admin, rows.map(row => row.influencer_id))
    proExpiredIds = rows.filter(row => (proStatuses.get(row.influencer_id) ?? 'free') === 'free').map(row => row.id)
    if (proExpiredIds.length) {
      await admin.from('campaign_influencers').update({
        application_status: 'rejected', status: 'inactive',
        notes: 'Postulación cerrada automáticamente: la influencer ya no cuenta con Plan Pro activo.',
        updated_at: now,
      }).in('id', proExpiredIds)
    }
  }

  return NextResponse.json({ ok: true, closed: ids.length, rejected: pendingIds.length, pro_expired_rejected: proExpiredIds.length })
}
