import { isDeliverableComplete } from '@/lib/deliverable-status'

type SupabaseAdmin = ReturnType<typeof import('@/lib/supabase/server').createAdminClient>

// Historial de campañas de una influencer, para priorizar en la selección a
// quienes aún no han tenido oportunidades. Solo lectura, solo admin.
//
// Fuente: campaign_influencers.application_status (única fuente de verdad, 16.1)
// + campaign_deliverables (criterio único isDeliverableComplete).
//
// - applications:  filas en campaign_influencers (postulaciones/invitaciones).
// - selected:      application_status = 'accepted'.
// - participations: seleccionada Y realizó la campaña:
//     · entregó ≥1 contenido (isDeliverableComplete, sin contar asistencia), o
//     · confirmó asistencia, no quedó como no_show y la campaña está completed.
//   Seleccionada que no entregó nada / no asistió / declinó → no cuenta.
// - contents:      contenidos entregados (deliverables completos, excluye asistencia).
//
// Se excluye la campaña actual: mide historial previo.
export interface InfluencerCampaignHistory {
  applications: number
  selected: number
  participations: number
  contents: number
}

const ATTENDANCE_TYPES = new Set(['event_attendance', 'event_checkin'])
const CHUNK = 100

type CiRow = {
  id: string
  influencer_id: string
  campaign_id: string
  application_status: string | null
  campaign: { status: string | null } | { status: string | null }[] | null
}
type DelRow = {
  campaign_influencer_id: string | null
  campaign_id: string
  type: string | null
  status: string | null
  content_url: string | null
  published_url: string | null
  attendance_response: string | null
  attendance_outcome: string | null
}

export async function getInfluencerCampaignHistory(
  admin: SupabaseAdmin,
  influencerIds: string[],
  excludeCampaignId?: string,
): Promise<Map<string, InfluencerCampaignHistory>> {
  const result = new Map<string, InfluencerCampaignHistory>()
  const ids = Array.from(new Set(influencerIds.filter(Boolean)))
  for (const id of ids) result.set(id, { applications: 0, selected: 0, participations: 0, contents: 0 })
  if (ids.length === 0) return result

  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)

    let ciQuery = admin
      .from('campaign_influencers')
      .select('id, influencer_id, campaign_id, application_status, campaign:campaigns (status)')
      .in('influencer_id', chunk)
    let delQuery = admin
      .from('campaign_deliverables')
      .select('campaign_influencer_id, campaign_id, type, status, content_url, published_url, attendance_response, attendance_outcome')
      .in('influencer_id', chunk)
    if (excludeCampaignId) {
      ciQuery = ciQuery.neq('campaign_id', excludeCampaignId)
      delQuery = delQuery.neq('campaign_id', excludeCampaignId)
    }

    const [{ data: ciRows, error: ciError }, { data: delRows, error: delError }] = await Promise.all([ciQuery, delQuery])
    if (ciError || delError) {
      // El consumidor decide si bloquea; el detalle de campaña no lo hace.
      throw ciError ?? delError
    }

    const delsByCi = new Map<string, DelRow[]>()
    for (const d of (delRows ?? []) as DelRow[]) {
      if (!d.campaign_influencer_id) continue
      const list = delsByCi.get(d.campaign_influencer_id) ?? []
      list.push(d)
      delsByCi.set(d.campaign_influencer_id, list)
    }

    for (const ci of (ciRows ?? []) as CiRow[]) {
      const h = result.get(ci.influencer_id)
      if (!h) continue
      h.applications += 1
      if (ci.application_status !== 'accepted') continue
      h.selected += 1

      const dels = delsByCi.get(ci.id) ?? []
      const contents = dels.filter(d => !ATTENDANCE_TYPES.has(d.type ?? '') && isDeliverableComplete(d)).length
      h.contents += contents

      const campaign = Array.isArray(ci.campaign) ? ci.campaign[0] : ci.campaign
      const attended = campaign?.status === 'completed' && dels.some(d =>
        d.type === 'event_attendance' && d.attendance_response === 'confirmed' && d.attendance_outcome !== 'no_show'
      )
      if (contents > 0 || attended) h.participations += 1
    }
  }

  return result
}
