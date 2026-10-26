import type { SupabaseClient } from '@supabase/supabase-js'

export type OrgMemberRole = 'brand_manager' | 'member' | 'finance'

/** Rol que se otorga al INVITAR a alguien nuevo (brand_members.role → organization_members.role). */
export function officialRoleFor(role: string): OrgMemberRole {
  return role === 'finance' ? 'finance' : role === 'member' ? 'member' : 'brand_manager'
}

/** Valor de brand_members.role que refleja el rol real de organization_members. */
export function brandMemberRoleFor(role: string, isOwner: boolean): string {
  if (isOwner) return 'owner'
  return role === 'finance' || role === 'member' ? role : 'brand_manager'
}

export type EnsuredMembership = { role: string; is_owner: boolean; created: boolean; preserved: boolean }

// Concede acceso a una marca SIN reducir permisos existentes.
// organization_members es la fuente de verdad del rol (CLAUDE.md 16.2):
//  - Sin fila → se crea con el rol solicitado (invitación nueva).
//  - Fila ACTIVA → se conservan rol e is_owner; solo se asegura brand_id. Reenviar o
//    re-invitar nunca baja a un owner/brand_manager ni sube a nadie en silencio.
//  - Fila INACTIVA (acceso revocado) → nuevo otorgamiento: rol solicitado, sin owner.
// Lanza si Supabase devuelve error (nunca deja la operación a medias sin avisar).
export async function ensureBrandMembership(
  admin: SupabaseClient,
  p: { organizationId: string; brandId: string | null; userId: string; requestedRole: string },
): Promise<EnsuredMembership> {
  const requested = officialRoleFor(p.requestedRole)
  const now = new Date().toISOString()

  const load = async () => {
    const { data, error } = await admin
      .from('organization_members')
      .select('id, role, is_owner, is_active, brand_id')
      .eq('organization_id', p.organizationId)
      .eq('user_id', p.userId)
      .maybeSingle()
    if (error) throw error
    return data as { id: string; role: string; is_owner: boolean; is_active: boolean; brand_id: string | null } | null
  }

  let existing = await load()
  if (!existing) {
    const { error } = await admin.from('organization_members').insert({
      organization_id: p.organizationId, brand_id: p.brandId, user_id: p.userId,
      role: requested, is_owner: false, is_active: true, joined_at: now,
    })
    if (!error) return { role: requested, is_owner: false, created: true, preserved: false }
    if ((error as { code?: string }).code !== '23505') throw error
    existing = await load() // carrera: otra petición la creó entre el select y el insert
    if (!existing) throw error
  }

  if (existing.is_active) {
    if (!existing.brand_id && p.brandId) {
      const { error } = await admin.from('organization_members').update({ brand_id: p.brandId }).eq('id', existing.id)
      if (error) throw error
    }
    return { role: existing.role, is_owner: existing.is_owner, created: false, preserved: true }
  }

  const { error } = await admin.from('organization_members').update({
    role: requested, is_owner: false, is_active: true, brand_id: existing.brand_id ?? p.brandId, joined_at: now,
  }).eq('id', existing.id)
  if (error) throw error
  return { role: requested, is_owner: false, created: false, preserved: false }
}
