import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'

type Params = { params: { id: string } }

/**
 * POST/DELETE /api/brands/[id]/influencers
 * Asigna/quita influencers directamente a una marca vía brand_influencers
 * (fuera de campañas) — usado por el tab "Influencers" del detalle de marca
 * en admin. La tabla y su RLS ("Admins can manage brand influencers") ya
 * existían; lo único que faltaba era este endpoint de escritura y el botón
 * en la UI (ver GET /api/brands/[id], que ya lee brand_influencers).
 *
 * Mismo patrón de auth que el resto de /api/brands/[id]: solo exige usuario
 * autenticado (no hay chequeo explícito de rol admin todavía en ese
 * recurso) — se mantiene consistente, no se endurece acá.
 */
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

  const { error } = await admin
    .from('brand_influencers')
    .delete()
    .eq('brand_id', params.id)
    .eq('influencer_id', influencerId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
