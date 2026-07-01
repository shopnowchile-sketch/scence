import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'
import { isOrgAdmin } from '@/lib/influencers/authz'

// GET /api/locations — lista de lugares de la organización (gap G-13)
export async function GET(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return NextResponse.json({ data: [] })

  if (!(await isOrgAdmin(admin, user.id, orgId))) {
    return NextResponse.json({ error: 'Solo administradores pueden ver lugares' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type')

  let query = admin
    .from('locations')
    .select('*')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })

  if (type) query = query.eq('type', type)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data: data ?? [] })
}

// POST /api/locations — crear lugar
export async function POST(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return NextResponse.json({ error: 'Organization not found' }, { status: 400 })

  if (!(await isOrgAdmin(admin, user.id, orgId))) {
    return NextResponse.json({ error: 'Solo administradores pueden crear lugares' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  if (!body?.name || !body?.type) {
    return NextResponse.json({ error: 'Nombre y tipo son requeridos' }, { status: 422 })
  }

  const { data, error } = await admin
    .from('locations')
    .insert({
      organization_id:     orgId,
      name:                body.name,
      type:                body.type,
      address:             body.address || null,
      city:                body.city || null,
      region:              body.region || null,
      country:             body.country || 'Chile',
      is_private:          !!body.is_private,
      brand_id:            body.brand_id || null,
      owner_influencer_id: body.owner_influencer_id || null,
      notes:               body.notes || null,
      created_by:          user.id,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data }, { status: 201 })
}
