import { NextRequest, NextResponse } from 'next/server'
import { suggestShippingAddress } from '@/lib/shipping-suggestion'
import { authorizeInfluencerShipping, setPrimaryShipping, isUuid, SHIPPING_COLUMNS } from '@/lib/influencer-shipping'

export const dynamic = 'force-dynamic'

// GET: mis direcciones de envío activas (principal primero).
export async function GET(req: NextRequest) {
  const auth = await authorizeInfluencerShipping()
  if ('res' in auth) return auth.res
  const { data, error } = await auth.admin.from('locations').select(SHIPPING_COLUMNS)
    .eq('level', 'place').eq('type', 'influencer_home').eq('owner_influencer_id', auth.influencerId).eq('is_active', true)
    .order('is_primary', { ascending: false }).order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // Sugerencia opcional (?campaign_id=): nunca obligatoria, solo si hay datos suficientes.
  const campaignId = new URL(req.url).searchParams.get('campaign_id')
  const suggested_id = isUuid(campaignId) ? await suggestShippingAddress(auth.admin, campaignId, (data ?? []) as Array<{ id: string }>) : null
  return NextResponse.json({ data, suggested_id })
}

// POST: nueva dirección (comuna + calle). Dueño y organización los fija el servidor.
export async function POST(req: NextRequest) {
  const auth = await authorizeInfluencerShipping()
  if ('res' in auth) return auth.res
  const body = await req.json().catch(() => null)
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const address = typeof body?.address === 'string' ? body.address.trim() : ''
  if (!name || !address) return NextResponse.json({ error: 'Nombre y dirección son obligatorios' }, { status: 422 })
  if (name.length > 120 || address.length > 300) return NextResponse.json({ error: 'Texto demasiado largo' }, { status: 422 })
  if (!isUuid(body?.parent_id)) return NextResponse.json({ error: 'Selecciona la comuna' }, { status: 422 })

  const { data: created, error } = await auth.admin.from('locations').insert({
    level: 'place', type: 'influencer_home', is_private: true,
    name, address, parent_id: body.parent_id,
    organization_id: auth.organizationId, owner_influencer_id: auth.influencerId,
  }).select(SHIPPING_COLUMNS).single()
  if (error || !created) return NextResponse.json({ error: error?.message ?? 'No se pudo guardar' }, { status: 422 })

  // La primera dirección, o una pedida explícitamente, queda como principal.
  const { count } = await auth.admin.from('locations').select('id', { count: 'exact', head: true })
    .eq('type', 'influencer_home').eq('owner_influencer_id', auth.influencerId).eq('is_active', true).eq('is_primary', true)
  if (body?.is_primary === true || !count) {
    const e = await setPrimaryShipping(auth.admin, auth.influencerId, created.id as string)
    if (e) return NextResponse.json({ error: e.message }, { status: 500 })
    created.is_primary = true
  }
  return NextResponse.json({ data: created }, { status: 201 })
}
