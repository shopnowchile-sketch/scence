// Una marca tiene solo DOS roles: owner y member (brand_manager y member son lo mismo: operación completa
// de campañas, postulaciones, influencers, lugares y reportes; sin equipo, facturación ni datos de la marca).
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
  ]),
}

export function roleHasBrandPermission(role: BrandRole | string, permission: BrandPermission): boolean {
  return BRAND_ROLE_PERMISSIONS[normalizeBrandRole(role)].has(permission)
}
