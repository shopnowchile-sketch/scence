import { NextRequest, NextResponse } from 'next/server'
import { authorizeInfluencerShipping, isUuid } from '@/lib/influencer-shipping'

type Params = { params: { id: string } }

// PATCH /api/influencer/campaigns/[id]/barters/shipping
// Body: { benefit_id, location_id } — la influencer confirma dónde recibe ESTE envío.
// El location_id queda en barter_benefits.shipping_location_id: cambiar luego su dirección
// principal, o desactivar la dirección, no altera el despacho ya asociado (la fila se conserva).
export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await authorizeInfluencerShipping()
  if ('res' in auth) return auth.res
  const { admin, influencerId } = auth
  const body = await req.json().catch(() => null)
  if (!isUuid(params.id) || !isUuid(body?.benefit_id) || !isUuid(body?.location_id)) {
    return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })
  }

  // El beneficio debe ser de un canje propio, en esta campaña, y ser un envío.
  const { data: benefit } = await admin.from('barter_benefits')
    .select('id, delivery_method, status, barter_id, barters!inner(influencer_id, campaign_id)')
    .eq('id', body.benefit_id).maybeSingle()
  const barter = benefit?.barters as unknown as { influencer_id: string; campaign_id: string } | null
  if (!benefit || !barter || barter.influencer_id !== influencerId || barter.campaign_id !== params.id) {
    return NextResponse.json({ error: 'Beneficio no encontrado' }, { status: 404 })
  }
  if (benefit.delivery_method !== 'shipping') return NextResponse.json({ error: 'Este beneficio no es un envío.' }, { status: 422 })
  if (['delivered', 'completed'].includes(String(benefit.status))) {
    return NextResponse.json({ error: 'El envío ya fue entregado; no se puede cambiar la dirección.' }, { status: 409 })
  }

  // La dirección debe ser suya y estar activa.
  const { data: addr } = await admin.from('locations').select('id')
    .eq('id', body.location_id).eq('type', 'influencer_home').eq('owner_influencer_id', influencerId).eq('is_active', true).maybeSingle()
  if (!addr) return NextResponse.json({ error: 'Dirección no encontrada' }, { status: 404 })

  const { error } = await admin.from('barter_benefits').update({ shipping_location_id: addr.id }).eq('id', benefit.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
