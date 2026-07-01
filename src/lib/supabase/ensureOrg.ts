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
