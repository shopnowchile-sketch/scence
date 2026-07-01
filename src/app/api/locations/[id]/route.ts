import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'
import { isOrgAdmin } from '@/lib/influencers/authz'

type Params = { params: { id: string } }

// PATCH /api/locations/[id] — actualizar lugar
export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return NextResponse.json({ error: 'Organization not found' }, { status: 400 })

  if (!(await isOrgAdmin(admin, user.id, orgId))) {
    return NextResponse.json({ error: 'Solo administradores pueden editar lugares' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const allowed = {
    name:                body.name,
    type:                body.type,
    address:             body.address,
    city:                body.city,
    region:              body.region,
    country:             body.country,
    is_private:          body.is_private,
    brand_id:            body.brand_id,
    owner_influencer_id: body.owner_influencer_id,
    notes:               body.notes,
  }
  Object.keys(allowed).forEach(k => {
    if ((allowed as Record<string, unknown>)[k] === undefined) delete (allowed as Record<string, unknown>)[k]
  })

  const { data, error } = await admin
    .from('locations')
    .update({ ...allowed, updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .eq('organization_id', orgId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}

// DELETE /api/locations/[id] — borrar lugar
export async function DELETE(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return NextResponse.json({ error: 'Organization not found' }, { status: 400 })

  if (!(await isOrgAdmin(admin, user.id, orgId))) {
    return NextResponse.json({ error: 'Solo administradores pueden borrar lugares' }, { status: 403 })
  }

  const { error } = await admin
    .from('locations')
    .delete()
    .eq('id', params.id)
    .eq('organization_id', orgId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
