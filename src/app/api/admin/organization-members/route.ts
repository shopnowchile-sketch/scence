import { NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { getOrgId, isPlatformAdmin } from '@/lib/supabase/ensureOrg'

/**
 * GET /api/admin/organization-members
 * Read-only directory for the canonical SCENCE organization.
 * Never uses user-editable metadata to authorize access.
 */
export async function GET() {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  const admin = createAdminClient()
  if (!(await isPlatformAdmin(user.id, admin))) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }

  const organizationId = await getOrgId(user.id, user.user_metadata, admin)
  if (!organizationId) {
    return NextResponse.json({ error: 'No se encontró la organización de SCENCE' }, { status: 404 })
  }

  const [{ data: organization, error: organizationError }, { data: memberships, error: membershipError }] =
    await Promise.all([
      admin.from('organizations').select('id, name, slug').eq('id', organizationId).single(),
      admin
        .from('organization_members')
        .select('id, user_id, role, is_owner, is_active, invited_at, joined_at, created_at, profile:profiles(full_name, display_name)')
        .eq('organization_id', organizationId)
        .order('is_owner', { ascending: false })
        .order('created_at', { ascending: true }),
    ])

  if (organizationError || !organization) {
    console.error('[admin organization members] organization lookup failed:', organizationError?.message)
    return NextResponse.json({ error: 'No se pudo cargar la organización' }, { status: 500 })
  }
  if (membershipError) {
    console.error('[admin organization members] membership lookup failed:', membershipError.message)
    return NextResponse.json({ error: 'No se pudieron cargar los miembros' }, { status: 500 })
  }

  const rows = memberships ?? []
  const pendingIds = new Set(rows.map(row => row.user_id).filter((id): id is string => Boolean(id)))
  const authUsers = new Map<string, { email: string | null; created_at: string | null }>()

  // Supabase Auth listUsers is paginated. Iterate only until all users attached
  // to this organization have been found; never return unrelated Auth records.
  const perPage = 1000
  for (let page = 1; pendingIds.size > 0; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) {
      console.error('[admin organization members] auth lookup failed:', error.message)
      return NextResponse.json({ error: 'No se pudieron cargar los emails de los miembros' }, { status: 502 })
    }

    const users = data.users ?? []
    if (users.length === 0) break

    for (const authUser of users) {
      if (pendingIds.has(authUser.id)) {
        authUsers.set(authUser.id, {
          email: authUser.email ?? null,
          created_at: authUser.created_at ?? null,
        })
        pendingIds.delete(authUser.id)
      }
    }

    if (users.length < perPage) break
  }

  const data = rows.map(row => {
    const authUser = authUsers.get(row.user_id)
    const profile = Array.isArray(row.profile) ? row.profile[0] : row.profile
    return {
      id: row.id,
      user_id: row.user_id,
      name: profile?.display_name || profile?.full_name || null,
      email: authUser?.email ?? null,
      role: row.role,
      is_owner: row.is_owner,
      is_active: row.is_active,
      invited_at: row.invited_at,
      joined_at: row.joined_at,
      created_at: row.created_at,
      account_created_at: authUser?.created_at ?? null,
    }
  })

  return NextResponse.json({
    organization: { id: organization.id, name: organization.name, slug: organization.slug },
    data,
    totals: {
      members: data.length,
      active: data.filter(member => member.is_active).length,
      inactive: data.filter(member => !member.is_active).length,
    },
  })
}
