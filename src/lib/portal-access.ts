import type { BrandAccess } from '@/lib/supabase/ensureOrg'

/**
 * Capabilities are derived on the server from the canonical records, never
 * from auth metadata.  Keeping the decision pure makes the portal redirects
 * testable without turning a JWT claim into an authorization source.
 */
export type PortalAccess = {
  isPlatformAdmin: boolean
  isInfluencer: boolean
  brand: BrandAccess | null
}

export function defaultPortalPath(access: PortalAccess): '/admin-dash' | '/inf-dash' | '/brand-dash' | '/login' {
  if (access.isPlatformAdmin) return '/admin-dash'
  if (access.isInfluencer) return '/inf-dash'
  if (access.brand) return '/brand-dash'
  return '/login'
}

export function canEnterInfluencerPortal(access: PortalAccess): boolean {
  return access.isInfluencer
}

export function canEnterBrandPortal(access: PortalAccess): boolean {
  return access.brand !== null
}
