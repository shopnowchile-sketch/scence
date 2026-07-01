import type { SupabaseClient } from '@supabase/supabase-js'

/** Roles considerados administradores para acciones destructivas (borrado permanente).
 *  Debe coincidir con el enum user_role de la BD:
 *  'super_admin' | 'brand_manager' | 'influencer' | 'finance'
 */
const ADMIN_ROLES = ['super_admin']

/**
 * Determina si el usuario es administrador autorizado de la organización.
 * Autorizado = miembro con is_owner=true O con role administrativo.
 */
export async function isOrgAdmin(
  admin: SupabaseClient,
  userId: string,
  orgId: string,
): Promise<boolean> {
  const { data } = await admin
    .from('organization_members')
    .select('is_owner, role')
    .eq('user_id', userId)
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .limit(1)
    .single()

  if (!data) return false
  if (data.is_owner === true) return true
  return ADMIN_ROLES.includes(String(data.role ?? '').toLowerCase())
}
