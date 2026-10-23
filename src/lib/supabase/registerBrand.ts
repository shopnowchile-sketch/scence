import type { SupabaseClient, User } from '@supabase/supabase-js'
import { decideBrandRegistration, type RegistrationActor, type RegistrationDecision } from '@/lib/brand-registration-policy'
import { brandStatusAllows } from '@/lib/brand-status-access'
import { hasBrandPermission, isPlatformAdmin, resolveBrandAccess } from '@/lib/supabase/ensureOrg'

export type RegisterBrandInput = {
  /** Columnas de `brands` (nunca id, estado, dueño, plan ni fechas: la función las ignora). */
  brand: Record<string, unknown>
  org?: { logo_url?: string | null; country?: string | null }
  registeredBy: string
  /** Solo en autorregistro: la persona que queda como responsable de su propia marca. */
  ownerUserId?: string | null
  /** Misma clave = misma solicitud (reintentos). */
  key?: string | null
}

export type RegisterBrandResult =
  | { ok: true; brandId: string; organizationId: string; outcome: 'created' | 'replayed' | 'conflict' }
  | { ok: false; error: string }

/**
 * Crea organización + marca (siempre `pending_approval`) en UNA transacción,
 * de forma idempotente y sin organizaciones huérfanas, mediante la función SQL
 * `register_brand` (migración 20261022160000, solo service_role).
 *
 * Si la función no existe en la base, FALLA CERRADO (no crea nada): ya no hay camino de
 * respaldo no atómico, que podía dejar organizaciones huérfanas. Aplicar la migración
 * ANTES de desplegar este código.
 */
export async function registerBrandAtomic(admin: SupabaseClient, input: RegisterBrandInput): Promise<RegisterBrandResult> {
  const { data, error } = await admin.rpc('register_brand', {
    p_brand: input.brand,
    p_registered_by: input.registeredBy,
    p_idempotency_key: input.key ?? null,
    p_owner_user_id: input.ownerUserId ?? null,
    p_org: input.org ?? {},
  })

  if (!error) {
    const row = Array.isArray(data) ? data[0] : data
    if (!row?.out_brand_id) return { ok: false, error: 'register_brand no devolvió resultado' }
    return { ok: true, brandId: row.out_brand_id, organizationId: row.out_organization_id, outcome: row.out_outcome }
  }

  const missing = error.code === 'PGRST202' || error.code === '42883' || /could not find the function/i.test(error.message)
  if (!missing) {
    console.error('[registerBrandAtomic] rpc failed:', error.message)
    return { ok: false, error: error.message }
  }

  // Falla cerrado: sin la función NO se crea nada. El camino anterior (organización y marca en dos
  // pasos) podía dejar organizaciones huérfanas si el segundo paso fallaba. Orden de despliegue:
  // primero la migración (aditiva), después este código.
  console.error('[registerBrandAtomic] register_brand no existe en la base; registro bloqueado hasta aplicar la migración 20261022160000')
  return { ok: false, error: 'register_brand_unavailable' }
}

/** Reúne los hechos del actor y aplica la política de registro de marcas. */
export async function authorizeBrandRegistration(admin: SupabaseClient, user: User): Promise<RegistrationDecision> {
  const [platformAdmin, influencerRow, brandAccess] = await Promise.all([
    isPlatformAdmin(user.id, admin),
    admin.from('influencers').select('id, is_active').eq('user_id', user.id).maybeSingle().then(r => r.data),
    resolveBrandAccess(user.id),
  ])
  const bannedUntil = (user as User & { banned_until?: string | null }).banned_until
  const actor: RegistrationActor = {
    emailVerified: Boolean(user.email_confirmed_at),
    banned: Boolean(bannedUntil && new Date(bannedUntil).getTime() > Date.now()),
    isPlatformAdmin: platformAdmin,
    influencer: influencerRow ? { isActive: influencerRow.is_active !== false } : null,
    brand: brandAccess ? { operates: brandStatusAllows(brandAccess.status, 'operate'), canManageProfile: hasBrandPermission(brandAccess, 'brand.manage', 'status') } : null,
  }
  return decideBrandRegistration(actor)
}
