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
  /** Marca real para buscar el contrato: la asociada, o la que resultó de convertir el lead del CRM. */
  contract_brand_id: string | null
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

// ── Importar colaboradoras que ya existen (campaign_brands) ──────────────────
export interface ImportPlanInput {
  /** Marcas colaboradoras de la campaña según campaign_brands (sin la marca principal). */
  collaboratorBrandIds: string[]
  /** Marcas reales encontradas en `brands` (id → nombre). */
  brandNames: Map<string, string>
  /** Leads del CRM convertidos a cada marca (brand_id → ids de lead). */
  leadsByBrand: Map<string, string[]>
  /** Colaboraciones que ya existen en la campaña (no se tocan nunca). */
  existing: { brand_id: string | null; lead_id: string | null }[]
}

export interface ImportPlan {
  toInsert: { brand_id: string; lead_id: string | null; name: string }[]
  alreadyPresent: string[]
  /** No se importan: la marca no se pudo resolver con certeza. */
  needsReview: { brand_id: string; reason: string }[]
  /** Se importan solo por marca: el CRM tiene más de un lead convertido a esa marca. */
  ambiguousLeads: string[]
}

/** Decide qué importar. Idempotente: lo que ya existe (por marca o por su lead) se omite. */
export function planCollaboratorImport(input: ImportPlanInput): ImportPlan {
  const existingBrands = new Set(input.existing.map(e => e.brand_id).filter((v): v is string => !!v))
  const existingLeads = new Set(input.existing.map(e => e.lead_id).filter((v): v is string => !!v))
  const plan: ImportPlan = { toInsert: [], alreadyPresent: [], needsReview: [], ambiguousLeads: [] }
  const seen = new Set<string>()
  for (const brandId of input.collaboratorBrandIds) {
    if (seen.has(brandId)) continue
    seen.add(brandId)
    const name = input.brandNames.get(brandId)
    if (!name) { plan.needsReview.push({ brand_id: brandId, reason: 'La marca no existe en el catálogo de marcas' }); continue }
    const leads = input.leadsByBrand.get(brandId) ?? []
    const leadId = leads.length === 1 ? leads[0] : null
    if (leads.length > 1) plan.ambiguousLeads.push(name)
    if (existingBrands.has(brandId) || (leadId && existingLeads.has(leadId))) { plan.alreadyPresent.push(name); continue }
    plan.toInsert.push({ brand_id: brandId, lead_id: leadId, name })
  }
  return plan
}

/** La marca con la que se busca el contrato: la asociada directamente, o la que resultó de convertir su lead. */
export function resolveContractBrandId(brandId: string | null, leadConvertedBrandId: string | null): string | null {
  return brandId ?? leadConvertedBrandId ?? null
}
