/**
 * Navegación entre portales (hotfix identidad dual, 2026-10-23).
 *
 * Una misma identidad (mismo auth.users.id) puede ser influencer y, además,
 * miembro de una marca. Antes, el middleware trataba `is_brand` e
 * `is_influencer` como roles excluyentes y la marca ganaba: una influencer
 * invitada a una marca quedaba fuera de `/inf-*`.
 *
 * ESTO SOLO DECIDE NAVEGACIÓN. No autoriza nada: las páginas y las APIs
 * siguen verificando sesión, pertenencia a la marca y permisos en el servidor
 * (resolveBrandAccess / hasBrandPermission / isPlatformAdmin). Las banderas de
 * metadata nunca conceden datos; a lo sumo permiten abrir una pantalla cuya
 * API rechazará lo que no corresponda.
 *
 * Función pura y sin imports: se ejecuta en el runtime del middleware y se
 * prueba sin Next ni Supabase.
 */
export type PortalFlags = { isBrand: boolean; isInfluencer: boolean }

// Rutas exclusivas de admin (inaccesibles para influencers y marcas)
export const ADMIN_ONLY: readonly string[] = [
  '/admin-campaigns', '/admin-influencers', '/admin-analytics', '/admin-settings',
  '/admin-billing', '/admin-bookings', '/admin-brands', '/admin-payroll',
  '/admin-affiliates', '/admin-contracts', '/admin-events', '/admin-support',
  '/admin-dash', '/admin-crm',
]

// Rutas exclusivas del portal influencer
export const INFLUENCER_ONLY: readonly string[] = [
  '/inf-dash', '/inf-deliverables', '/inf-profile', '/inf-campaign', '/inf-campaigns',
  '/inf-bookings', '/inf-support', '/inf-brands',
  // legacy — keep for redirect safety
  '/dashboard', '/tasks', '/profile', '/my-campaigns', '/my-bookings',
]

// Rutas exclusivas del portal de marcas
export const BRAND_ONLY: readonly string[] = [
  '/brand-dash', '/brand-campaigns', '/brand-influencers', '/brand-support', '/brand-profile',
  // legacy
  '/brand',
]

const startsWithAny = (path: string, routes: readonly string[]) => routes.some(r => path.startsWith(r))

/**
 * Solo una cuenta con `is_influencer` y SIN `is_brand` que abre el portal de
 * marca necesita comprobar su membresía real: los metadatos no bastan.
 */
export function needsBrandMembershipCheck(flags: PortalFlags, path: string): boolean {
  return flags.isInfluencer && !flags.isBrand && startsWithAny(path, BRAND_ONLY)
}

/**
 * Devuelve la ruta a la que hay que redirigir, o null si se puede continuar.
 * `hasBrandMembership` solo se consulta cuando needsBrandMembershipCheck() es
 * verdadero; ante cualquier duda (error, sin dato) debe pasarse false.
 */
export function decidePortalRedirect(flags: PortalFlags, path: string, hasBrandMembership = false): string | null {
  const { isBrand, isInfluencer } = flags

  // Identidad dual declarada: ambos portales, entrada histórica por influencer.
  if (isBrand && isInfluencer) {
    if (path === '/login' || path === '/' || path === '/dashboard') return '/inf-dash'
    if (path === '/brand/dashboard') return '/brand-dash'
    if (startsWithAny(path, ADMIN_ONLY) && path !== '/influencers/support') return '/inf-dash'
    return null
  }

  if (isBrand) {
    // Marca → solo puede acceder al portal de marcas (comportamiento histórico)
    if (path === '/login' || path === '/' || path === '/brand/dashboard') return '/brand-dash'
    if (startsWithAny(path, ADMIN_ONLY) || startsWithAny(path, INFLUENCER_ONLY)) return '/brand-dash'
    return null
  }

  if (isInfluencer) {
    if (path === '/login' || path === '/' || path === '/dashboard') return '/inf-dash'
    // /influencers/support es accesible para influencers aunque /influencers esté en ADMIN_ONLY
    if (startsWithAny(path, ADMIN_ONLY) && path !== '/influencers/support') return '/inf-dash'
    if (startsWithAny(path, BRAND_ONLY)) {
      // Sin membresía activa de marca: comportamiento histórico. Con ella, puede entrar.
      if (!hasBrandMembership) return '/inf-dash'
      if (path === '/brand/dashboard') return '/brand-dash'
    }
    return null
  }

  // Admin (sin banderas)
  if (path === '/login' || path === '/') return '/admin-dash'
  if (INFLUENCER_ONLY.some(r => path === r || path.startsWith(r + '/'))) return '/admin-dash'
  if (startsWithAny(path, BRAND_ONLY)) return '/admin-dash'
  return null
}
