import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/locations'
import { authorizeCampaignLocations } from '@/lib/campaign-locations-auth'
import {
  campaignLocationDbError,
  normalizeInstructions,
  syncCampaignPrimaryLocation,
} from '@/lib/campaign-locations'

type Params = { params: { id: string; linkId: string } }

async function findLink(admin: any, campaignId: string, linkId: string) {
  // El vínculo debe pertenecer a ESTA campaña: autorizar la campaña no basta.
  const { data } = await admin.from('campaign_locations').select('id').eq('id', linkId).eq('campaign_id', campaignId).maybeSingle()
  return data as { id: string } | null
}

// PATCH /api/campaigns/[id]/locations/[linkId] — { instructions?, is_primary?: true }
export async function PATCH(req: NextRequest, { params }: Params) {
  if (!isUuid(params.id) || !isUuid(params.linkId)) return NextResponse.json({ error: 'Identificador inválido' }, { status: 400 })
  const access = await authorizeCampaignLocations(params.id, 'campaign.manage')
  if (!access.ok) return access.response
  const { admin } = access.auth

  if (!(await findLink(admin, params.id, params.linkId))) return NextResponse.json({ error: 'Dirección no encontrada' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  if ('instructions' in (body ?? {})) {
    const instructions = normalizeInstructions(body.instructions)
    if (!instructions.ok) return NextResponse.json({ error: instructions.error }, { status: 422 })
    const { error } = await admin.from('campaign_locations').update({ instructions: instructions.value }).eq('id', params.linkId)
    if (error) {
      const e = campaignLocationDbError(error)
      return NextResponse.json({ error: e.error }, { status: e.status })
    }
  }

  try {
    if (body?.is_primary === true) {
      const { error } = await admin.rpc('campaign_locations_set_primary', { p_campaign_id: params.id, p_link_id: params.linkId })
      if (error) throw new Error(error.message)
    }
    return NextResponse.json({ data: await syncCampaignPrimaryLocation(admin, params.id) })
  } catch (error) {
    return NextResponse.json({ error: `El cambio se guardó, pero no se pudo actualizar el calendario y la ficha (${error instanceof Error ? error.message : 'error desconocido'}). Reintenta: la sincronización es idempotente.` }, { status: 500 })
  }
}

// DELETE /api/campaigns/[id]/locations/[linkId] — quita la asociación (el lugar sigue en el catálogo).
// Si era la principal, la base promueve la siguiente (trigger).
export async function DELETE(_req: NextRequest, { params }: Params) {
  if (!isUuid(params.id) || !isUuid(params.linkId)) return NextResponse.json({ error: 'Identificador inválido' }, { status: 400 })
  const access = await authorizeCampaignLocations(params.id, 'campaign.manage')
  if (!access.ok) return access.response
  const { admin } = access.auth

  if (!(await findLink(admin, params.id, params.linkId))) return NextResponse.json({ error: 'Dirección no encontrada' }, { status: 404 })

  const { error } = await admin.from('campaign_locations').delete().eq('id', params.linkId).eq('campaign_id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  try {
    return NextResponse.json({ data: await syncCampaignPrimaryLocation(admin, params.id) })
  } catch (e) {
    return NextResponse.json({ error: `La dirección se quitó, pero no se pudo actualizar el calendario y la ficha (${e instanceof Error ? e.message : 'error desconocido'}). Reintenta: la sincronización es idempotente.` }, { status: 500 })
  }
}
