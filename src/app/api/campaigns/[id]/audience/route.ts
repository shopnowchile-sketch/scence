import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/locations'
import { authorizeCampaignLocations } from '@/lib/campaign-locations-auth'
import { loadLocationRows } from '@/lib/influencer-location'
import { loadAudienceTargets } from '@/lib/campaign-audience'

type Params = { params: { id: string } }

const MAX_ZONES = 400

export const dynamic = 'force-dynamic'

// GET /api/campaigns/[id]/audience — zonas a las que se muestra la campaña (vacío = todas).
// Admin: cualquier campaña. Marca: solo las suyas (404 si es ajena).
export async function GET(_req: NextRequest, { params }: Params) {
  if (!isUuid(params.id)) return NextResponse.json({ error: 'Identificador inválido' }, { status: 400 })
  const access = await authorizeCampaignLocations(params.id, 'campaign.read')
  if (!access.ok) return access.response
  try {
    const ids = (await loadAudienceTargets(access.auth.admin, [params.id])).get(params.id) ?? []
    return NextResponse.json({ data: await describe(access.auth.admin, ids) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error al cargar la segmentación' }, { status: 500 })
  }
}

// PUT /api/campaigns/[id]/audience — reemplaza el conjunto de zonas. Body: { location_ids: string[] }.
// Solo nodos geográficos activos de `locations`; [] quita la restricción.
export async function PUT(req: NextRequest, { params }: Params) {
  if (!isUuid(params.id)) return NextResponse.json({ error: 'Identificador inválido' }, { status: 400 })
  const access = await authorizeCampaignLocations(params.id, 'campaign.manage')
  if (!access.ok) return access.response
  const { admin } = access.auth

  const body = await req.json().catch(() => ({}))
  const raw = body?.location_ids
  if (!Array.isArray(raw) || raw.length > MAX_ZONES || !raw.every(isUuid)) {
    return NextResponse.json({ error: 'location_ids inválido' }, { status: 400 })
  }
  const ids = Array.from(new Set(raw as string[]))

  try {
    const nodes = await loadLocationRows(admin)
    const valid = new Set(nodes.filter(n => n.is_active).map(n => n.id))
    if (!ids.every(id => valid.has(id))) {
      return NextResponse.json({ error: 'Alguna zona no existe o no es geográfica.' }, { status: 422 })
    }

    // Primero se agregan las nuevas y después se quitan las sobrantes: si algo falla a medias
    // la campaña nunca queda sin restricción por error (fallar abierto).
    if (ids.length) {
      const { error: insError } = await admin
        .from('campaign_audience_locations')
        .upsert(ids.map(location_id => ({ campaign_id: params.id, location_id })), { onConflict: 'campaign_id,location_id', ignoreDuplicates: true })
      if (insError) return NextResponse.json({ error: insError.message }, { status: 500 })
    }
    let del = admin.from('campaign_audience_locations').delete().eq('campaign_id', params.id)
    if (ids.length) del = del.not('location_id', 'in', `(${ids.join(',')})`)
    const { error: delError } = await del
    if (delError) return NextResponse.json({ error: delError.message }, { status: 500 })
    return NextResponse.json({ data: await describe(admin, ids) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error al guardar la segmentación' }, { status: 500 })
  }
}

async function describe(admin: Parameters<typeof loadLocationRows>[0], ids: string[]) {
  if (!ids.length) return []
  const nodes = await loadLocationRows(admin)
  const byId = new Map(nodes.map(n => [n.id, n]))
  return ids.flatMap(id => {
    const node = byId.get(id)
    if (!node) return []
    const parent = node.parent_id ? byId.get(node.parent_id) : undefined
    return [{ id, name: node.name, level: node.level, parent: parent?.name ?? null }]
  })
}
