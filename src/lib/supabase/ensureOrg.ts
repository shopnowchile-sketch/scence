import type { SupabaseClient } from '@supabase/supabase-js'

export type OrgRole = 'super_admin' | 'brand_manager' | 'finance' | 'influencer'

/** Roles con acceso completo (billing, payroll, eliminación, settings de team) */
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
  const isAdmin = isOwner || ADMIN_ROLES.includes(role)
  return { role, isOwner, isAdmin }
}

/**
 * getOrgId — get the organization_id for a user.
 * First checks JWT metadata (fast path), then falls back to organization_members table
 * in case the JWT hasn't been refreshed after org creation.
 */
export async function getOrgId(userId: string, userMeta: Record<string, unknown> | undefined, admin: SupabaseClient): Promise<string | null> {
  const fromJwt = userMeta?.organization_id as string | undefined
  if (fromJwt) return fromJwt
  // Fallback: look up via organization_members
  const { data } = await admin
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', userId)
    .eq('is_active', true)
    .limit(1)
    .single()
  return (data?.organization_id as string | null) ?? null
}

/**
 * ensureOrg — auto-provision an organization for the user on first login.
 * If the user already has organization_id in metadata, returns it as-is.
 * If not, creates a new org using organization_name from metadata (set during registration),
 * then updates the user's metadata with the new organization_id.
 */
import { createAdminClient } from './server'
import type { User } from '@supabase/supabase-js'

export async function ensureOrg(user: User): Promise<string | null> {
  const existing = user.user_metadata?.organization_id as string | undefined
  if (existing) return existing

  const orgName: string =
    (user.user_metadata?.organization_name as string | undefined) ??
    (user.email?.split('@')[1]?.split('.')[0] ?? 'My Organization')

  const admin = createAdminClient()

  // Create org
  const { data: org, error: orgErr } = await admin
    .from('organizations')
    .insert({
      name: orgName,
      slug: orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60),
      type: 'brand',
    })
    .select('id')
    .single()

  if (orgErr) {
    console.error('[ensureOrg] failed to create org:', orgErr.message)
    return null
  }

  // Update user metadata with org id
  const { error: updateErr } = await admin.auth.admin.updateUserById(user.id, {
    user_metadata: {
      ...user.user_metadata,
      organization_id: org.id,
    },
  })

  if (updateErr) {
    console.error('[ensureOrg] failed to update user metadata:', updateErr.message)
  }

  // Upsert profile (profiles table has no organization_id column)
  await admin.from('profiles').upsert({
    id: user.id,
    full_name: user.user_metadata?.full_name as string ?? '',
    display_name: user.user_metadata?.full_name as string ?? '',
    role: 'brand_manager',
  }, { onConflict: 'id' })

  // Add user as org member (owner)
  await admin.from('organization_members').upsert({
    organization_id: org.id,
    user_id: user.id,
    role: 'brand_manager',
    is_owner: true,
    is_active: true,
    joined_at: new Date().toISOString(),
  }, { onConflict: 'organization_id,user_id' })

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

  const { data: org } = await admin
    .from('organizations')
    .select('id')
    .order('created_at', { ascending: true })
    .limit(1)
    .single()

  if (!org) {
    console.error('[ensureInfluencerRow] organización principal no encontrada')
    return null
  }

  const displayName = (user.user_metadata?.display_name as string | undefined)
    ?? (user.user_metadata?.full_name as string | undefined)
    ?? user.email
    ?? 'Creador'

  const { data: influencer, error } = await admin
    .from('influencers')
    .insert({
      organization_id: org.id,
      user_id:         user.id,
      display_name:    displayName,
      email:            user.email ?? null,
    })
    .select('id, display_name')
    .single()

  // FIX (2026-07-04, root cause "no veía las campañas" — 33 cuentas afectadas):
  // `influencers.user_id` tiene un UNIQUE constraint (influencers_user_id_key).
  // Este check-then-insert no es atómico: si el layout se invoca 2 veces casi
  // en simultáneo para el mismo usuario (doble efecto de React, prefetch +
  // navegación real, o un reintento de red en conexión mobile inestable),
  // ambas pasan el chequeo `existing` (ninguna ve la fila del otro todavía) y
  // la SEGUNDA insert falla con "duplicate key value violates unique
  // constraint" — visto repetido en los logs de Postgres. Antes esto se
  // logueaba y se retornaba null silenciosamente, dejando a esa cuenta SIN
  // fila de influencer para siempre (cada visita futura repetía el mismo
  // fallo porque `existing` seguía sin encontrar nada... hasta que SÍ hay una
  // fila, solo que la creó la otra request concurrente). Ahora, ante ese error
  // específico, se vuelve a buscar por user_id — la fila de la request que sí
  // ganó la carrera debe existir ya.
  if (error) {
    if (error.code === '23505') {
      const { data: wonByOther } = await admin
        .from('influencers')
        .select('id, display_name')
        .eq('user_id', user.id)
        .single()
      if (wonByOther) return wonByOther
    }
    console.error('[ensureInfluencerRow] failed to create influencer row:', error.message)
    return null
  }

  return influencer
}
