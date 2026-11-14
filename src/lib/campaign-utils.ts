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
  published_url?: string | null
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

// ── Formatters ────────────────────────────────────────────────────────────────

export function fmtDate(iso: string | null | undefined, opts?: Intl.DateTimeFormatOptions) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-CL', opts ?? {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

export function fmtMoney(n: number | null | undefined, currency = 'CLP') {
  if (!n) return '—'
  return new Intl.NumberFormat('es-CL', {
    style: 'currency', currency, minimumFractionDigits: 0,
  }).format(n)
}

// Única normalización de campaigns.campaign_benefits (admin y marca, crear y editar).
export function normalizeCampaignBenefits(value: unknown) {
  if (!Array.isArray(value)) return []
  const types = new Set(['product', 'experience', 'meal', 'ticket', 'gift_card', 'service', 'sales_commission', 'other'])
  const rules = new Set(['deliverables_completed', 'sales_target', 'attendance', 'accepted', 'manual', 'raffle'])
  return value.flatMap(raw => {
    if (!raw || typeof raw !== 'object') return []
    const benefit = raw as Record<string, unknown>
    const benefitType = String(benefit.benefit_type ?? '')
    const activationRule = String(benefit.activation_rule ?? '')
    const description = String(benefit.description ?? '').trim()
    if (!types.has(benefitType) || !rules.has(activationRule) || !description) return []
    return [{
      benefit_type: benefitType,
      description,
      quantity: Math.max(1, Math.trunc(Number(benefit.quantity) || 1)),
      estimated_value: benefit.estimated_value == null ? null : Math.max(0, Number(benefit.estimated_value) || 0),
      commission_rate: benefitType === 'sales_commission' ? Math.min(100, Math.max(0, Number(benefit.commission_rate) || 0)) : null,
      currency: typeof benefit.currency === 'string' ? benefit.currency : 'CLP',
      activation_rule: activationRule,
      sales_target: activationRule === 'sales_target' ? Math.max(1, Math.trunc(Number(benefit.sales_target) || 1)) : null,
    }]
  })
}
