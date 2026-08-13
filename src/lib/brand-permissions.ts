export type BrandRole = 'owner' | 'brand_manager' | 'member' | 'finance'

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
  brand_manager: new Set<BrandPermission>([
    'brand.read', 'campaign.read', 'campaign.manage', 'application.read',
    'application.manage', 'influencer.read', 'influencer.manage',
    'location.read', 'location.manage', 'report.read',
  ]),
  member: new Set<BrandPermission>([
    'brand.read', 'campaign.read', 'application.read', 'influencer.read', 'location.read',
  ]),
  finance: new Set<BrandPermission>([
    'brand.read', 'billing.read', 'billing.manage',
    'financial_document.read', 'financial_document.manage',
  ]),
}

export function roleHasBrandPermission(role: BrandRole, permission: BrandPermission): boolean {
  return BRAND_ROLE_PERMISSIONS[role].has(permission)
}
