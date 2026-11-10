// Soporte: rol real del autor de un ticket. Función pura (sin base de datos)
// para poder probarla. La ruta `/api/tickets` hace las consultas y la usa.
//
// Regla: «Admin» SOLO si el autor es super_admin activo en organization_members
// (la fuente de autorización). Un autor que no se puede clasificar NUNCA se
// presenta como Admin: se muestra como «Usuario sin perfil».

export type SubmitterType = 'influencer' | 'brand' | 'admin' | 'unknown'

export interface TicketSubmitter {
  name: string
  email: string
  type: SubmitterType
  profile_href?: string
}

export interface SubmitterSources {
  userIds: string[]
  /** user_id de los usuarios con membresía activa de plataforma (super_admin). */
  platformAdminIds: Set<string>
  influencers: { id: string; user_id: string | null; display_name: string | null; email: string | null }[]
  brands: { id: string; user_id: string | null; name: string | null; contact_name: string | null; contact_email: string | null }[]
  brandMembers: { user_id: string | null; brand_id: string; email: string | null; name: string | null }[]
  /** Datos del perfil existente (profiles + Auth) para el fallback. */
  accounts: Record<string, { name?: string | null; email?: string | null }>
}

export function buildSubmitterMap(src: SubmitterSources): Record<string, TicketSubmitter> {
  const map: Record<string, TicketSubmitter> = {}
  const account = (id: string) => src.accounts[id] ?? {}

  for (const id of src.userIds) {
    if (src.platformAdminIds.has(id)) {
      map[id] = { name: account(id).name || account(id).email || 'Admin', email: account(id).email ?? '', type: 'admin' }
    }
  }

  for (const inf of src.influencers) {
    if (!inf.user_id || map[inf.user_id]) continue
    map[inf.user_id] = {
      name: inf.display_name ?? inf.email ?? 'Influencer',
      email: inf.email ?? '',
      type: 'influencer',
      profile_href: `/admin-influencers/${inf.id}`,
    }
  }

  for (const b of src.brands) {
    if (!b.user_id || map[b.user_id]) continue
    map[b.user_id] = {
      name: b.contact_name ?? b.name ?? 'Marca',
      email: b.contact_email ?? '',
      type: 'brand',
      profile_href: `/admin-brands/${b.id}`,
    }
  }

  for (const m of src.brandMembers) {
    if (!m.user_id || map[m.user_id]) continue
    map[m.user_id] = {
      name: m.name || m.email || 'Usuario de marca',
      email: m.email ?? account(m.user_id).email ?? '',
      type: 'brand',
      profile_href: `/admin-brands/${m.brand_id}?tab=members&user=${m.user_id}`,
    }
  }

  // Sin ficha de influencer/marca ni permisos de plataforma: no se asume Admin.
  for (const id of src.userIds) {
    if (map[id]) continue
    const a = account(id)
    map[id] = { name: a.name || a.email || 'Usuario sin perfil', email: a.email ?? '', type: 'unknown' }
  }

  return map
}
