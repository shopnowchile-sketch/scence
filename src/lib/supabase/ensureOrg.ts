import type { SupabaseClient } from '@supabase/supabase-js'
import { roleHasBrandPermission, normalizeBrandRole, type BrandPermission, type BrandRole } from '@/lib/brand-permissions'
import { brandStatusAllows, capabilityForPermission, type BrandCapability } from '@/lib/brand-status-access'
import { exactEmailPattern } from '@/lib/email-match'
import { reconcileOrphanProSubscriptions } from '@/lib/influencer-pro'
export type { BrandPermission } from '@/lib/brand-permissions'

export type OrgRole = 'super_admin' | 'brand_manager' | 'member' | 'finance' | 'influencer'

/** Roles con acceso global de plataforma (SCENCE). */
export const ADMIN_ROLES: OrgRole[] = ['super_admin']

/**
 * getUserRole — obtiene el rol del usuario en su organización.
 * Retorna null si el usuario no es miembro de ninguna org.
 */
export async function getUserRole(
  userId: string,
  orgId: string,
  admin: SupabaseClient
): Promise<{ role: OrgRole | null; isOwner: boolean; isAdmin: boolean }> {
  const { data } = await admin
    .from('organization_members')
    .select('role, is_owner')
    .eq('user_id', userId)
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .limit(1)
    .single()

  if (!data) return { role: null, isOwner: false, isAdmin: false }
  const role = data.role as OrgRole
  const isOwner = data.is_owner === true
  // Ser owner solo otorga administración de SU organización; no concede
  // acceso global a campañas, CRM, marcas ni datos de SCENCE. Antes esta
  // mezcla hacía que el owner de cualquier marca fuera tratado como admin.
  const isAdmin = ADMIN_ROLES.includes(role)
  return { role, isOwner, isAdmin }
}

/**
 * getOrgId — obtiene la organización activa del usuario desde la fuente
 * canónica de autorización: `organization_members`.
 *
 * `userMeta` se conserva temporalmente en la firma para no obligar a migrar
 * todos los callers en el mismo commit, pero nunca se usa para autorizar.
 */
export async function getOrgId(userId: string, _userMeta: Record<string, unknown> | undefined, admin: SupabaseClient): Promise<string | null> {
  // Determinista: un usuario puede tener más de una membresía activa (p. ej.
  // super_admin de SCENCE + otra org). Antes `.limit(1)` sin orden devolvía
  // cualquiera y el admin recibía 403 al azar. Prioriza la membresía de
  // plataforma y, si no hay, la más antigua.
  const { data } = await admin
    .from('organization_members')
    .select('organization_id, role')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('created_at', { ascending: true })
  const memberships = data ?? []
  const platform = memberships.find(m => ADMIN_ROLES.includes(m.role as OrgRole))
  return ((platform ?? memberships[0])?.organization_id as string | undefined) ?? null
}

/**
 * isPlatformAdmin — única definición de "admin de plataforma" (SCENCE).
 * Lee `organization_members` (nunca profiles.role ni user_metadata) y no
 * depende de qué organización devuelva getOrgId.
 */
export async function isPlatformAdmin(userId: string, admin: SupabaseClient): Promise<boolean> {
  const { data } = await admin
    .from('organization_members')
    .select('id')
    .eq('user_id', userId)
    .eq('is_active', true)
    .in('role', ADMIN_ROLES)
    .limit(1)
  return (data?.length ?? 0) > 0
}

import { createAdminClient } from './server'
import type { User } from '@supabase/supabase-js'

/*
 * Las organizaciones ya no se crean aquí: nacen con la marca dentro de la función
 * SQL register_brand (ver registerBrand.ts). El antiguo ensureOrg() se eliminó.
 */

/**
 * provisionOrgForBrand — crea una organización aislada para una marca
 * colaboradora liviana (sin cuenta/login todavía). Mismo patrón de slug +
 * reintento por colisión que ensureOrg(), pero SIN ningún paso de usuario
 * (no auth user, no `profiles`, no `organization_members`) — la marca
 * colaboradora recién creada no tiene owner hasta que alguien se registre
 * después con ese email.
 *
 * Pedido de Pri 2026-07-12 (marcas colaboradoras): "si no existe, se crea una
 * nueva marca CON SU ORGANIZACIÓN" — necesario porque en este modelo cada
 * marca vive en su propio org aislado (ver ensureOrg/ensureBrandRow); si la
 * co-marca quedara bajo el org de quien invita, contaminaría los límites de
 * plan/roster de la marca principal el día que esa co-marca se registre.
 */
export async function provisionOrgForBrand(brandName: string): Promise<string | null> {
  const admin = createAdminClient()

  const baseSlug = brandName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'org'
  const suffix = Math.random().toString(36).slice(2, 8)

  const insertOrg = (slug: string) =>
    admin.from('organizations').insert({ name: brandName, slug, type: 'brand' }).select('id').single()

  let { data: org, error } = await insertOrg(baseSlug)

  if (error?.code === '23505') {
    ;({ data: org, error } = await insertOrg(`${baseSlug}-${suffix}`.slice(0, 60)))
  }

  if (error || !org) {
    console.error('[provisionOrgForBrand] failed to create org:', error?.message)
    return null
  }

  return org.id
}

/**
 * ensureInfluencerRow — auto-provision an `influencers` row for a
 * self-registered creador on first portal entry.
 *
 * FIX (B-18, 2026-07-02): el trigger de DB `handle_new_user()` crea una
 * organización nueva y aislada por cada signup (brand o influencer, sin
 * distinguir) y nunca toca la tabla `influencers` — un creador que se
 * auto-registra queda con login funcional pero invisible en ranking, lista
 * de influencers y dashboard, porque esas vistas filtran por
 * `organization_id` de la organización real (Scence SpA), no por la
 * organización huérfana que el trigger le asignó.
 *
 * Esto es el fix de ENTRADA AL PORTAL (mismo patrón que ensureOrg, usado acá
 * mismo, y que /api/brand/register ya usa para marcas). No corrige el
 * trigger ni repara cuentas históricas — eso es una migración aparte.
 *
 * Usa la organización más antigua (Scence SpA) como destino, NO
 * user_metadata.organization_id, que para signups self-service apunta a la
 * organización huérfana creada por el trigger.
 */
export async function ensureInfluencerRow(user: User): Promise<{ id: string; display_name: string } | null> {
  if (!user.user_metadata?.is_influencer) return null

  const admin = createAdminClient()

  const { data: existing } = await admin
    .from('influencers')
    .select('id, display_name')
    .eq('user_id', user.id)
    .single()

  if (existing) return existing

  // FIX (2026-07-04, dedup automático): antes, si no había fila con este
  // user_id, se creaba una fila NUEVA sin más. Si el creador ya existía como
  // fila "huérfana" (agregada por admin/import, sin user_id todavía — el caso
  // típico: Catalina Huito, Silvia, Rebeca resueltos a mano esta semana), el
  // auto-registro generaba un 2do registro duplicado en vez de vincular el
  // existente. Pri: "porque las influencers nuevas llegan aca? puedes hacer
  // esto automatico?" (refiriéndose al panel de duplicados). Ahora, antes de
  // insertar, se busca por email (case-insensitive) una fila sin user_id
  // todavía — si existe, se vincula (UPDATE user_id) en vez de duplicar.
  // Esto NO repara duplicados históricos (eso sigue siendo manual desde
  // /admin-influencers/data-quality) — solo evita que se sigan creando nuevos
  // por esta vía específica.
  if (user.email) {
    const { data: orphan } = await admin
      .from('influencers')
      .select('id, display_name')
      .is('user_id', null)
      .ilike('email', user.email)
      .limit(1)
      .maybeSingle()

    if (orphan) {
      // Nunca vincular al usuario una influencer incompleta: también debe tener
      // Instagram antes de poder entrar al portal.
      const { data: orphanInstagram } = await admin
        .from('influencer_social_profiles')
        .select('id')
        .eq('influencer_id', orphan.id)
        .eq('platform', 'instagram')
        .not('username', 'is', null)
        .limit(1)
        .maybeSingle()

      if (!orphanInstagram) {
        console.error('[ensureInfluencerRow] influencer orphan sin Instagram; no se vincula')
        return null
      }

      const { error: linkErr } = await admin
        .from('influencers')
        .update({ user_id: user.id })
        .eq('id', orphan.id)
      if (linkErr) {
        console.error('[ensureInfluencerRow] failed to link orphan row:', linkErr.message)
      } else {
        return orphan
      }
    }
  }

  // Respaldo que ya NO crea filas (2026-10-22). Antes asignaba a la influencer nueva «la organización más
  // antigua»; el modelo de SCENCE no tiene una organización de plataforma, y la antigüedad (o un nombre)
  // no es una relación real. Las cuentas nuevas las provisiona handle_new_user() y las filas creadas por
  // admin o por una marca se vinculan arriba por correo. Si no hay relación verificable, se falla cerrado
  // y se deja registro para resolverlo a mano; no se asigna ninguna organización arbitraria.
  console.error('[ensureInfluencerRow] sin fila de influencer ni organización verificable; no se crea por antigüedad ni por nombre')
  return null
}

/**
 * ensureBrandRow — auto-provisiona la fila `brands` para una marca.
 *
 * FIX (2026-07-10, root cause "Empresa1 no aparece en /admin-brands"): antes,
 * la fila en `brands` solo se creaba en el PRIMER LOGIN exitoso (ver
 * /api/brand/register, llamado por (brand)/layout.tsx al montar). Si el
 * email de confirmación no llegaba, o el usuario cerraba la pestaña en la
 * pantalla "Revisa tu email" sin volver a intentar, la cuenta quedaba
 * existiendo SOLO en auth.users — invisible en el admin, sin organización,
 * sin fila de marca. Confirmado por SQL: fmicchile@gmail.com (Empresa1)
 * creado 2026-07-10 sin brand_id.
 *
 * Ahora esta función se llama en DOS puntos: (1) justo después de crear el
 * auth user en /api/auth/register-brand — así la marca existe y es visible
 * en el admin como pending_approval aunque el email de confirmación falle o
 * nunca se abra; (2) en /api/brand/register en el primer login — no-op si ya
 * existe (idempotente), sirve de red de seguridad para cuentas creadas antes
 * de este fix o para cualquier caso donde el punto (1) no se haya podido
 * ejecutar.
 *
 * Mismo patrón que ensureInfluencerRow: dedup por user_id, dedup/vinculación
 * por email huérfano (fila creada a mano por admin o de un intento anterior
 * fallido), ensureOrg() para organización propia del tenant (SCENCE es
 * multi-org por marca), status inicial 'pending_approval', recuperación de
 * carrera 23505.
 */
export async function ensureBrandRow(user: User): Promise<{ id: string; name: string; status: string } | null> {
  const admin = createAdminClient()

  const { data: existing } = await admin
    .from('brands')
    .select('id, name, status')
    .eq('user_id', user.id)
    .single()

  if (existing) return existing

  const contactEmail = user.email ?? null
  const brandName    = (user.user_metadata?.brand_name as string | undefined) ?? user.email ?? 'Mi Marca'
  const contactName  = (user.user_metadata?.full_name as string | undefined) ?? null

  // Coincidencia exacta del correo: `_`, `%` y `*` NO son comodines aquí (ver
  // email-match.ts). Si el correo no se puede comparar sin ambigüedad, no se
  // vincula ninguna marca existente y se crea una nueva en pending_approval.
  const orphanEmailPattern = contactEmail ? exactEmailPattern(contactEmail) : null
  if (orphanEmailPattern) {
    const { data: orphan } = await admin
      .from('brands')
      .select('id, name, status')
      .is('user_id', null)
      .ilike('contact_email', orphanEmailPattern)
      .limit(1)
      .maybeSingle()

    if (orphan) {
      const { error: linkErr } = await admin
        .from('brands')
        .update({ user_id: user.id })
        .eq('id', orphan.id)
      if (linkErr) {
        console.error('[ensureBrandRow] failed to link orphan row:', linkErr.message)
      } else {
        return orphan
      }
    }
  }

  const rawReferral = user.user_metadata?.referred_by_instagram
  const referredByInstagram = typeof rawReferral === 'string' && rawReferral.trim()
    ? rawReferral.trim().replace(/^@/, '').toLowerCase()
    : null

  // El dato que escribe la marca es un @usuario, pero el vínculo debe quedar
  // contra la influencer (no solo como texto) para poder atribuir su referido
  // y una futura comisión. El match se hace una vez al crear la marca.
  let referredByInfluencerId: string | null = null
  if (referredByInstagram) {
    const { data: socialProfile } = await admin
      .from('influencer_social_profiles')
      .select('influencer_id')
      .eq('platform', 'instagram')
      .ilike('username', referredByInstagram)
      .limit(1)
      .maybeSingle()
    referredByInfluencerId = socialProfile?.influencer_id ?? null
  }

  // Organización propia + marca (pending_approval) + membresía de responsable en
  // UNA transacción idempotente por usuario (register_brand): reintentos y
  // llamadas simultáneas (register-brand + primer login) devuelven la misma
  // marca, sin organizaciones duplicadas ni huérfanas. El responsable lo es solo
  // de su propia marca (sin permisos globales ni sobre otras marcas).
  const { registerBrandAtomic } = await import('./registerBrand')
  const registered = await registerBrandAtomic(admin, {
    brand: {
      name: brandName,
      contact_name: contactName,
      contact_email: contactEmail,
      referred_by_influencer_id: referredByInfluencerId,
      metadata: referredByInstagram ? { referred_by_instagram: referredByInstagram } : {},
    },
    registeredBy: user.id,
    ownerUserId: user.id,
    key: `self:${user.id}`,
  })

  if (!registered.ok || registered.outcome === 'conflict') {
    // Carrera residual: otra llamada pudo ganar justo antes.
    const { data: wonByOther } = await admin.from('brands').select('id, name, status').eq('user_id', user.id).maybeSingle()
    if (wonByOther) return wonByOther
    console.error('[ensureBrandRow] failed to create brand row:', registered.ok ? 'conflict' : registered.error)
    return null
  }

  // Mejor esfuerzo: presentación (metadata) y perfil. Nunca conceden acceso;
  // el acceso sale de organization_members.
  const { error: metaErr } = await admin.auth.admin.updateUserById(user.id, {
    user_metadata: { ...user.user_metadata, organization_id: registered.organizationId },
  })
  if (metaErr) console.error('[ensureBrandRow] no se pudo guardar organization_id en metadata:', metaErr.message)
  await admin.from('profiles').upsert({
    id: user.id,
    full_name: (user.user_metadata?.full_name as string | undefined) ?? '',
    display_name: (user.user_metadata?.full_name as string | undefined) ?? '',
    role: 'brand_manager',
  }, { onConflict: 'id' })

  const { data: brand } = await admin.from('brands').select('id, name, status').eq('id', registered.brandId).single()
  return brand ?? { id: registered.brandId, name: brandName, status: 'pending_approval' }
}

/**
 * resolveBrandAccess — fuente canónica de acceso del portal Marca.
 *
 * Lee exclusivamente `organization_members` y resuelve la marca mediante
 * `brands.organization_id`. Si una organización tiene más de una marca,
 * exige además `organization_members.brand_id`; nunca intenta adivinarla
 * usando campos legacy.
 */
export type BrandAccess = {
  brandId: string
  organizationId: string
  role: BrandRole
  isOwner: boolean
  /** Estado de aprobación de la marca (brands.status). Gobierna qué puede hacer. */
  status: string | null
}

/**
 * Permiso de rol Y estado de la marca. El servidor aplica la tabla de estados
 * (brand-status-access.ts): una marca pendiente, rechazada o suspendida solo
 * conserva las capacidades que su estado permite, aunque su rol las tenga.
 * `capability` permite exigir una capacidad distinta de la que corresponde al
 * permiso (p. ej. el checklist de aprobación lee campañas con `onboarding`).
 */
export function hasBrandPermission(
  access: BrandAccess | null,
  permission: BrandPermission,
  capability: BrandCapability = capabilityForPermission(permission),
): boolean {
  if (!access) return false
  return roleHasBrandPermission(access.role, permission) && brandStatusAllows(access.status, capability)
}

/**
 * Pagar el plan de suscripción (PayPal): solo el owner (brand.manage) y en los estados que hoy pueden contratar:
 * pendiente (elige plan antes de la aprobación) y suspendida (reactiva). Una marca rechazada no. Conserva lo que
 * producción permite hoy a las marcas pendientes; la facturación operativa sigue gobernada por hasBrandPermission.
 */
export function canPayBrandPlan(access: BrandAccess | null): boolean {
  if (!access || !roleHasBrandPermission(access.role, 'brand.manage')) return false
  return brandStatusAllows(access.status, 'billing_manage') || brandStatusAllows(access.status, 'onboarding')
}

export async function resolveBrandAccess(userId: string): Promise<BrandAccess | null> {
  const admin = createAdminClient()

  const { data: orgMemberships } = await admin
    .from('organization_members')
    .select('organization_id, brand_id, role, is_owner')
    .eq('user_id', userId)
    .eq('is_active', true)
    // 'finance' ya no es un rol de marca: no concede acceso (falla cerrado).
    .in('role', ['brand_manager', 'member'])
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })

  // Determinista para usuarios con varias marcas: primero las membresías con
  // brand_id explícito, luego la más antigua (sort estable sobre created_at).
  const memberships = [...(orgMemberships ?? [])].sort((a, b) => Number(!a.brand_id) - Number(!b.brand_id))

  for (const membership of memberships) {
    let brandQuery = admin
      .from('brands')
      .select('id, organization_id, status')
      .eq('organization_id', membership.organization_id)
    if (membership.brand_id) brandQuery = brandQuery.eq('id', membership.brand_id)
    const { data: brand } = await brandQuery.maybeSingle()
    if (brand) {
      return {
        brandId: brand.id,
        organizationId: brand.organization_id,
        role: normalizeBrandRole(membership.role, membership.is_owner === true),
        isOwner: membership.is_owner === true,
        status: (brand.status as string | null) ?? null,
      }
    }
  }

  return null
}

/**
 * linkPendingBrandMembership — vincula una invitación pendiente de
 * `brand_members` (email coincide, `user_id` todavía null) al usuario que
 * acaba de iniciar sesión por primera vez. Es bootstrap explícito: primero
 * materializa `organization_members` y solo después una request puede ser
 * autorizada por `resolveBrandAccess`. No crea otra marca u organización.
 *
 * Retorna true si vinculó algo (el caller debe volver a resolver el acceso
 * después de llamar esto).
 */
export async function linkPendingBrandMembership(user: User): Promise<boolean> {
  if (!user.email) return false
  const admin = createAdminClient()

  const { data: pending } = await admin
    .from('brand_members')
    .select('id, brand_id, role')
    .is('user_id', null)
    .ilike('email', user.email)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (!pending) return false

  const { data: brand } = await admin
    .from('brands')
    .select('organization_id')
    .eq('id', pending.brand_id)
    .maybeSingle()

  if (!brand) return false

  const { error } = await admin
    .from('brand_members')
    .update({ user_id: user.id, joined_at: new Date().toISOString() })
    .eq('id', pending.id)

  if (error) {
    console.error('[linkPendingBrandMembership] failed to link:', error.message)
    return false
  }

  // Una marca tiene solo owner y member; todo no-owner se guarda como 'brand_manager' (igual que el trigger).
  const orgRole: OrgRole = 'brand_manager'
  const { error: membershipError } = await admin.from('organization_members').upsert({
    organization_id: brand.organization_id,
    brand_id: pending.brand_id,
    user_id: user.id,
    role: orgRole,
    is_owner: false,
    is_active: true,
    joined_at: new Date().toISOString(),
  }, { onConflict: 'organization_id,user_id' })

  if (membershipError) {
    console.error('[linkPendingBrandMembership] official membership sync failed:', membershipError.message)
    return false
  }

  return true
}
