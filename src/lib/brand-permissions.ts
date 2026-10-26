// Una marca tiene solo DOS roles: owner y member. member = operación completa (campañas, postulaciones,
// influencers, lugares, reportes) y facturación/finanzas de su propia marca. owner = además equipo, datos de la
// marca, documentos legales (solo el owner firma NDA) y el pago del plan de suscripción.
// Valores heredados de la base ('brand_manager', 'finance') se tratan como 'member' vía normalizeBrandRole.
export type BrandRole = 'owner' | 'member'

export function normalizeBrandRole(role: string | null | undefined, isOwner = false): BrandRole {
  return isOwner || role === 'owner' ? 'owner' : 'member'
}

export type BrandPermission =
  | 'brand.read'
  | 'brand.manage'
  | 'campaign.read'
  | 'campaign.manage'
  | 'application.read'
  | 'application.manage'
  | 'influencer.read'
  | 'influencer.manage'
  | 'location.read'
  | 'location.manage'
  | 'report.read'
  | 'team.read'
  | 'team.manage'
  | 'billing.read'
  | 'billing.manage'
  | 'financial_document.read'
  | 'financial_document.manage'
  | 'legal_document.read'
  | 'legal_document.manage'

const BRAND_ROLE_PERMISSIONS: Record<BrandRole, ReadonlySet<BrandPermission>> = {
  owner: new Set<BrandPermission>([
    'brand.read', 'brand.manage', 'campaign.read', 'campaign.manage',
    'application.read', 'application.manage', 'influencer.read', 'influencer.manage',
    'location.read', 'location.manage', 'report.read', 'team.read', 'team.manage',
    'billing.read', 'billing.manage', 'financial_document.read', 'financial_document.manage',
    'legal_document.read', 'legal_document.manage',
  ]),
  member: new Set<BrandPermission>([
    'brand.read', 'campaign.read', 'campaign.manage', 'application.read',
    'application.manage', 'influencer.read', 'influencer.manage',
    'location.read', 'location.manage', 'report.read',
    'billing.read', 'billing.manage', 'financial_document.read', 'financial_document.manage',
  ]),
}

export function roleHasBrandPermission(role: BrandRole | string, permission: BrandPermission): boolean {
  return BRAND_ROLE_PERMISSIONS[normalizeBrandRole(role)].has(permission)
}
