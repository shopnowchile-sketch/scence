import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getInfluencerProStatuses } from '@/lib/influencer-pro'
import { AUTO_CLOSE_NOTES, closePendingCampaignApplications } from '@/lib/campaign-applications'

// Cierra el ciclo sin borrar el historial: las pendientes pasan a rechazadas
// cuando vence la fecha de postulación.
export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const now = new Date().toISOString()
  const { data: campaigns, error } = await admin.from('campaigns').select('id').eq('status', 'active').not('application_deadline', 'is', null).lt('application_deadline', now).is('applications_closed_at', null)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const ids = (campaigns ?? []).map(c => c.id)
  let rejectedCount = 0
  if (ids.length) {
    // FIX (2026-09-06, causa raíz de las postulaciones fantasma): antes esta
    // ruta escribía `status: 'inactive'`, un valor que NO existe en el enum
    // campaign_status. application_status es la fuente de verdad; `status` no
    // se escribe. El cierre vive en closePendingCampaignApplications (UPDATE
    // por filtro, sin el tope de 1000 filas de un SELECT previo) y se revisa
    // su error antes de marcar la campaña como cerrada.
    const closed = await closePendingCampaignApplications(admin, { campaignIds: ids, note: AUTO_CLOSE_NOTES.deadline, now })
    if (!closed.ok) return NextResponse.json({ error: closed.error }, { status: 500 })
    rejectedCount = closed.rejected
    // Solo después de cerrar las postulaciones se marca la campaña como cerrada.
    const { error: closeError } = await admin.from('campaigns').update({ applications_closed_at: now, updated_at: now }).in('id', ids)
    if (closeError) return NextResponse.json({ error: closeError.message }, { status: 500 })
  }

  // Plan Pro vencido durante el proceso: una postulación (origin='application',
  // nunca invitación — ver /api/influencer/campaigns/[id]/apply) a campaña
  // PRIVADA solo pudo crearse con Pro activo. Si la influencer ya no tiene Pro
  // mientras sigue pending o accepted en una campaña todavía activa, queda
  // rechazada — mismo patrón sin borrar historial ni entregables ya creados.
  // Paginado: un SELECT de PostgREST corta en 1000 filas; sin paginar, las
  // filas restantes nunca se evaluaban.
  const PAGE_SIZE = 1000
  const rows: Array<{ id: string; influencer_id: string }> = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: privateRows, error: privateRowsError } = await admin
      .from('campaign_influencers')
      .select('id, influencer_id, campaigns!inner(visibility, status)')
      .eq('origin', 'application')
      .in('application_status', ['pending', 'accepted'])
      .eq('campaigns.visibility', 'private')
      .eq('campaigns.status', 'active')
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (privateRowsError) return NextResponse.json({ error: privateRowsError.message }, { status: 500 })
    const page = (privateRows ?? []) as unknown as Array<{ id: string; influencer_id: string }>
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
  }

  let proExpiredIds: string[] = []
  if (rows.length) {
    const proStatuses = await getInfluencerProStatuses(admin, rows.map(row => row.influencer_id))
    proExpiredIds = rows.filter(row => (proStatuses.get(row.influencer_id) ?? 'free') === 'free').map(row => row.id)
    // Mismo fix que arriba: `status: 'inactive'` no existe en el enum.
    // En lotes para no exceder el largo de URL del filtro `in`.
    for (let i = 0; i < proExpiredIds.length; i += 200) {
      const { error: proError } = await admin.from('campaign_influencers').update({
        application_status: 'rejected',
        notes: 'Postulación cerrada automáticamente: la influencer ya no cuenta con Plan Pro activo.',
        rejected_at: now,
        updated_at: now,
      }).in('id', proExpiredIds.slice(i, i + 200))
      if (proError) return NextResponse.json({ error: proError.message }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true, closed: ids.length, rejected: rejectedCount, pro_expired_rejected: proExpiredIds.length })
}
