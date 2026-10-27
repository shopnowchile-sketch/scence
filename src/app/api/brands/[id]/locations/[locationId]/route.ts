import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId, getUserRole, hasBrandPermission, resolveBrandAccess } from '@/lib/supabase/ensureOrg'
import { isUuid } from '@/lib/locations'

type Params = { params: { id: string; locationId: string } }

async function canEditBrand(user: { id: string; user_metadata?: Record<string, unknown> }, brandId: string, admin: ReturnType<typeof createAdminClient>) {
  const brandAccess = await resolveBrandAccess(user.id)
  if (brandAccess) {
    return brandAccess.brandId === brandId && hasBrandPermission(brandAccess, 'location.manage')
  }
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return false
  return (await getUserRole(user.id, orgId, admin)).isAdmin
}

// DELETE → desactiva el punto de venta (soft delete, §16.11: locations no se borra). Solo lugares de ESA marca.
export async function DELETE(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  if (!isUuid(params.id) || !isUuid(params.locationId)) return NextResponse.json({ error: 'Identificador inválido' }, { status: 400 })
  if (!(await canEditBrand(user, params.id, admin))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data, error } = await admin
    .from('locations')
    .update({ is_active: false })
    .eq('id', params.locationId).eq('brand_id', params.id).eq('level', 'place')
    .select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data?.length) return NextResponse.json({ error: 'Lugar no encontrado' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
