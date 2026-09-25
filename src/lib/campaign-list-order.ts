// Orden por defecto de la lista de campañas (admin y portal de marca):
// primero lo que requiere atención (activas), al final lo cerrado
// (completadas/canceladas); dentro de cada grupo, la última modificada primero.
const CAMPAIGN_STATUS_RANK: Record<string, number> = {
  active: 0,
  pending_approval: 1,
  paused: 2,
  draft: 3,
  completed: 4,
  canceled: 5,
}
const UNKNOWN_STATUS_RANK = 3.5 // estado nuevo/desconocido: antes de las cerradas

type OrderableCampaign = { status?: string | null; updated_at?: string | null; created_at?: string | null }

export function campaignStatusRank(status: string | null | undefined): number {
  return status && status in CAMPAIGN_STATUS_RANK ? CAMPAIGN_STATUS_RANK[status] : UNKNOWN_STATUS_RANK
}

function lastModified(c: OrderableCampaign): number {
  const t = Date.parse(c.updated_at ?? c.created_at ?? '')
  return Number.isNaN(t) ? 0 : t
}

export function compareCampaignsByPriority(a: OrderableCampaign, b: OrderableCampaign): number {
  const byStatus = campaignStatusRank(a.status) - campaignStatusRank(b.status)
  if (byStatus !== 0) return byStatus
  return lastModified(b) - lastModified(a)
}
