// ── Shared campaign utilities ─────────────────────────────────────────────────
// Used by admin, brand, and influencer portals.
// Single source of truth for status configs, formatters, and types.

// ── Types ─────────────────────────────────────────────────────────────────────

export type CampaignMode = 'admin' | 'brand' | 'influencer'

export type DeliverableStatus = 'pending' | 'in_review' | 'approved' | 'rejected' | 'published'

export interface CampaignBrand {
  id: string
  name: string
  logo_url: string | null
  website: string | null
}

export interface CampaignDeliverable {
  id: string
  title: string | null
  type: string
  platform: string | null
  due_date: string | null
  status: DeliverableStatus
  content_url: string | null
  notes?: string | null
  influencer_id?: string | null
  influencer?: { id: string; display_name: string; avatar_url: string | null } | null
}

export interface CampaignInfluencerRow {
  id: string
  display_name: string
  avatar_url: string | null
  email?: string | null
  fee?: number | null
  currency?: string
  status?: string
  deliverables?: CampaignDeliverable[]
}

export interface CampaignDetailData {
  id: string
  name: string
  status: string
  description: string | null
  brief?: string | null
  start_date: string | null
  end_date: string | null
  budget_total?: number | null
  currency: string
  commission_rate?: number | null
  visibility?: string | null
  brand: CampaignBrand | null
  deliverables: CampaignDeliverable[]
  influencers?: CampaignInfluencerRow[]
  // Influencer-specific
  my_fee?: number | null
  my_currency?: string
  is_self_created?: boolean
}

// ── Status configs ────────────────────────────────────────────────────────────

export const CAMPAIGN_STATUS: Record<string, { label: string; color: string }> = {
  draft:            { label: 'Borrador',   color: 'bg-gray-100 text-gray-500' },
  pending_approval: { label: 'En revisión', color: 'bg-amber-100 text-amber-700' },
  active:           { label: 'Activa',     color: 'bg-green-100 text-green-700' },
  paused:           { label: 'Pausada',    color: 'bg-amber-100 text-amber-700' },
  completed:        { label: 'Completada', color: 'bg-blue-100 text-blue-700' },
  canceled:         { label: 'Cancelada',  color: 'bg-red-100 text-red-500' },
}

export const DELIVERABLE_STATUS: Record<DeliverableStatus, { label: string; color: string }> = {
  pending:   { label: 'Pendiente',   color: 'bg-amber-100 text-amber-700' },
  in_review: { label: 'En revisión', color: 'bg-blue-100 text-blue-700' },
  approved:  { label: 'Aprobado',    color: 'bg-green-100 text-green-700' },
  rejected:  { label: 'Rechazado',   color: 'bg-red-100 text-red-500' },
  published: { label: 'Publicado',   color: 'bg-violet-100 text-violet-700' },
}

// ── Formatters ────────────────────────────────────────────────────────────────

export function fmtDate(iso: string | null | undefined, opts?: Intl.DateTimeFormatOptions) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-CL', opts ?? {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

export function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-CL', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export function fmtMoney(n: number | null | undefined, currency = 'CLP') {
  if (!n) return '—'
  return new Intl.NumberFormat('es-CL', {
    style: 'currency', currency, minimumFractionDigits: 0,
  }).format(n)
}

export function deliverableProgress(deliverables: CampaignDeliverable[]) {
  const total = deliverables.length
  const done  = deliverables.filter(d => d.status === 'approved' || d.status === 'published').length
  const pct   = total > 0 ? Math.round((done / total) * 100) : 0
  return { total, done, pct }
}
