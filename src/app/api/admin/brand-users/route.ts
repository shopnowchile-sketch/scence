import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { getOrgId, getUserRole } from '@/lib/supabase/ensureOrg'

export async function GET(_req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  const access = orgId ? await getUserRole(user.id, orgId, admin) : { isAdmin: false }
  if (!access.isAdmin) return NextResponse.json({ error: 'Solo administradores pueden ver los usuarios de marcas' }, { status: 403 })

  const [{ data: brands, error: brandsError }, { data: members, error: membersError }] = await Promise.all([
    admin.from('brands').select('id, name, user_id, contact_email, created_at').order('name'),
    admin.from('brand_members').select('id, brand_id, email, role, invited_at, joined_at, is_active').order('invited_at', { ascending: false }),
  ])
  if (brandsError || membersError) return NextResponse.json({ error: (brandsError ?? membersError)?.message }, { status: 500 })

  const ownerIds = Array.from(new Set((brands ?? []).map(b => b.user_id).filter((id): id is string => !!id)))
  const authEmails = new Map<string, string>()
  for (const id of ownerIds) {
    const { data } = await admin.auth.admin.getUserById(id)
    if (data?.user?.email) authEmails.set(id, data.user.email)
  }

  const rows = [
    ...(brands ?? []).filter(b => b.user_id || b.contact_email).map(b => ({
      id: `owner-${b.id}`,
      brand_id: b.id,
      brand_name: b.name,
      email: b.user_id ? (authEmails.get(b.user_id) ?? b.contact_email ?? '') : (b.contact_email ?? ''),
      role: 'owner',
      status: b.user_id ? 'activo' : 'sin owner',
      invited_at: b.created_at,
      member_id: null,
    })),
    ...(members ?? []).map(m => {
      const brand = (brands ?? []).find(b => b.id === m.brand_id)
      return {
        id: m.id,
        brand_id: m.brand_id,
        brand_name: brand?.name ?? 'Marca eliminada',
        email: m.email,
        role: m.role,
        status: m.is_active ? (m.joined_at ? 'activo' : 'pendiente') : 'desactivado',
        invited_at: m.invited_at,
        member_id: m.id,
      }
    }),
  ].sort((a, b) => a.brand_name.localeCompare(b.brand_name, 'es') || (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : 0))

  return NextResponse.json({ data: rows })
}
