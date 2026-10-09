// Constantes y tipos seguros para cliente y servidor (sin imports de servidor).

export const COLLAB_STATUSES = ['to_contact', 'contacted', 'negotiating', 'confirmed', 'declined'] as const
export type CollabStatus = typeof COLLAB_STATUSES[number]

/** Plan (nivel de aporte) definido para una campaña. */
export interface CampaignPlan {
  id: string
  campaign_id: string
  name: string
  amount: number | null
  description: string | null
  sort_order: number
}

/** Estándar sugerido (solo nombres: los montos los define cada campaña). */
export const STANDARD_PLAN_NAMES = ['Bronze', 'Gold', 'Naming'] as const

export const COLLAB_TYPES = ['gifting', 'products', 'services', 'cash', 'mixed'] as const
export type CollabType = typeof COLLAB_TYPES[number]

export const COLLAB_STATUS_LABEL: Record<CollabStatus, string> = {
  to_contact: 'Por contactar',
  contacted: 'Contactada',
  negotiating: 'En negociación',
  confirmed: 'Confirmada',
  declined: 'No participa',
}

export const COLLAB_TYPE_LABEL: Record<CollabType, string> = {
  gifting: 'Gifting',
  products: 'Productos',
  services: 'Servicios',
  cash: 'Aporte económico',
  mixed: 'Mixto',
}

export interface CollaborationRow {
  id: string
  campaign_id: string
  lead_id: string | null
  brand_id: string | null
  status: CollabStatus
  collaboration_type: CollabType | null
  plan_id: string | null
  plan_name: string | null
  plan_amount: number | null
  contribution_detail: string | null
  quantity: number | null
  next_step: string | null
  follow_up_date: string | null
  owner_id: string | null
  created_at: string
  updated_at: string
  /** Derivados de crm_leads / brands (no se guardan en la colaboración). */
  name: string
  logo_url: string | null
  contact_name: string | null
  contact_position: string | null
  contact_email: string | null
  contact_phone: string | null
  instagram: string | null
  industry: string | null
  owner_name: string | null
}

export interface CollaborationActivity {
  id: string
  action_type: string
  description: string | null
  created_at: string
  created_by: string | null
  created_by_name: string | null
  campaign_id: string | null
}
