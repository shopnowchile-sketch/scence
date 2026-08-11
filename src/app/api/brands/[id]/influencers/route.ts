import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId, getUserRole } from '@/lib/supabase/ensureOrg'

type Params = { params: { id: string } }

/**
 * POST/DELETE /api/brands/[id]/influencers
 * Asigna/quita influencers directamente a una marca vía brand_influencers
 * (fuera de campañas) — usado por el tab "Influencers" del detalle de marca
 * en admin. La tabla y su RLS ("Admins can manage brand influencers") ya
 * existían; lo único que faltaba era este endpoint de escritura y el botón
 * en la UI (ver GET /api/brands/[id], que ya lee brand_influencers).
 *
 * Es una ruta administrativa: nunca debe quedar disponible desde un portal
 * de marca, aunque esa cuenta tenga metadata JWT antigua.
 */
async function requirePlatformAdmin(user: { id: string; user_metadata: Record<string, unknown> }, admin: ReturnType<typeof createAdminClient>) {
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  const role = orgId ? await getUserRole(user.id, orgId, admin) : null
  return Boolean(role?.isAdmin)
}

export async function POST(req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { influencer_ids?: string[] }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const influencerIds = Array.isArray(body.influencer_ids)
    ? body.influencer_ids.filter((v): v is string => typeof v === 'string' && v.length > 0)
    : []

  if (influencerIds.length === 0) {
    return NextResponse.json({ error: 'Debes seleccionar al menos un influencer' }, { status: 400 })
  }

  const admin = createAdminClient()
  if (!await requirePlatformAdmin(user, admin)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: brand, error: brandError } = await admin
    .from('brands')
    .select('id, organization_id')
    .eq('id', params.id)
    .single()

  if (brandError || !brand) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })

  const rows = influencerIds.map(influencer_id => ({
    brand_id: params.id,
    influencer_id,
    organization_id: brand.organization_id,
  }))

  // upsert + ignoreDuplicates: reintentar asignar a alguien que ya estaba
  // asignado no debe tirar error de PK duplicada (brand_id, influencer_id).
  const { error } = await admin
    .from('brand_influencers')
    .upsert(rows, { onConflict: 'brand_id,influencer_id', ignoreDuplicates: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, assigned: influencerIds.length })
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const influencerId = req.nextUrl.searchParams.get('influencer_id')
  if (!influencerId) return NextResponse.json({ error: 'Falta influencer_id' }, { status: 400 })

  const admin = createAdminClient()
  if (!await requirePlatformAdmin(user, admin)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { error } = await admin
    .from('brand_influencers')
    .delete()
    .eq('brand_id', params.id)
    .eq('influencer_id', influencerId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
