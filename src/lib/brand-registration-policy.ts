/**
 * Quién puede registrar marcas (decisión de la fundadora, 2026-10-22):
 *  - influencers con cuenta verificada y activa;
 *  - usuarios de una marca APROBADA, con cuenta verificada y activa, y permiso
 *    para administrar el perfil de su marca;
 *  - administradores de plataforma autorizados.
 * Nunca una cuenta sin verificar. Registrar una marca NO concede `brand_manager`
 * ni permisos sobre otras marcas, y toda marca nueva nace `pending_approval`.
 */
export type RegistrationActor = {
  emailVerified: boolean
  banned: boolean
  isPlatformAdmin: boolean
  influencer: { isActive: boolean } | null
  /** `operates`: la marca está aprobada (puede operar). */
  brand: { operates: boolean; canManageProfile: boolean } | null
}

export type RegistrationDecision =
  | { allowed: true; as: 'platform_admin' | 'influencer' | 'brand' }
  | { allowed: false; reason: 'unverified' | 'inactive' | 'brand_not_approved' | 'not_authorized' }

export function decideBrandRegistration(actor: RegistrationActor): RegistrationDecision {
  if (!actor.emailVerified) return { allowed: false, reason: 'unverified' }
  if (actor.banned) return { allowed: false, reason: 'inactive' }
  if (actor.isPlatformAdmin) return { allowed: true, as: 'platform_admin' }
  if (actor.influencer?.isActive) return { allowed: true, as: 'influencer' }
  if (actor.brand) {
    if (!actor.brand.operates) return { allowed: false, reason: 'brand_not_approved' }
    return actor.brand.canManageProfile ? { allowed: true, as: 'brand' } : { allowed: false, reason: 'not_authorized' }
  }
  if (actor.influencer) return { allowed: false, reason: 'inactive' }
  return { allowed: false, reason: 'not_authorized' }
}

export function registrationDeniedMessage(reason: Extract<RegistrationDecision, { allowed: false }>['reason']): string {
  switch (reason) {
    case 'unverified': return 'Debes verificar tu correo para registrar marcas'
    case 'inactive': return 'Tu cuenta no está activa'
    case 'brand_not_approved': return 'Tu marca debe estar aprobada por SCENCE para registrar otras marcas'
    default: return 'No tienes permiso para registrar marcas'
  }
}

/** Clave de idempotencia: la misma persona reintentando la misma marca. */
export function registrationKey(registeredBy: string, brand: { contact_email?: unknown; instagram_handle_normalized?: unknown; name?: unknown }): string {
  const identity = [brand.contact_email, brand.instagram_handle_normalized, brand.name]
    .map(value => (typeof value === 'string' ? value.trim().toLowerCase() : ''))
    .find(Boolean) ?? ''
  return `${registeredBy}:${identity}`
}
