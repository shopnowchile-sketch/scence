import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/locations'
import { authorizeCampaignLocations } from '@/lib/campaign-locations-auth'
import {
  campaignLocationDbError,
  loadCampaignLocations,
  normalizeInstructions,
  syncCampaignPrimaryLocation,
} from '@/lib/campaign-locations'

type Params = { params: { id: string } }

// GET /api/campaigns/[id]/locations — direcciones de la campaña (principal primero).
// Admin: cualquier campaña. Marca: solo las suyas. Mismo endpoint para ambos portales.
export async function GET(_req: NextRequest, { params }: Params) {
  if (!isUuid(params.id)) return NextResponse.json({ error: 'Identificador inválido' }, { status: 400 })
  const access = await authorizeCampaignLocations(params.id, 'campaign.read')
  if (!access.ok) return access.response

  try {
    return NextResponse.json({ data: await loadCampaignLocations(access.auth.admin, params.id) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error al cargar direcciones' }, { status: 500 })
  }
}

// POST /api/campaigns/[id]/locations — asocia un lugar EXISTENTE de `locations`.
// Body: { location_id, instructions?, is_primary? }. Crear un lugar nuevo se hace
// con /api/locations (admin) o /api/brand/locations (marca) y luego se asocia aquí.
export async function POST(req: NextRequest, { params }: Params) {
  if (!isUuid(params.id)) return NextResponse.json({ error: 'Identificador inválido' }, { status: 400 })
  const access = await authorizeCampaignLocations(params.id, 'campaign.manage')
  if (!access.ok) return access.response
  const { auth, userId } = access
  const { admin, brandAccess } = auth

  const body = await req.json().catch(() => ({}))
  const locationId = typeof body?.location_id === 'string' ? body.location_id : ''
  if (!isUuid(locationId)) return NextResponse.json({ error: 'location_id inválido' }, { status: 400 })
  const instructions = normalizeInstructions(body?.instructions)
  if (!instructions.ok) return NextResponse.json({ error: instructions.error }, { status: 422 })

  // Una marca solo puede asociar lugares propios. Si no lo son, se responde igual
  // que si no existieran: no se revela el catálogo de otras marcas ni los domicilios privados.
  if (brandAccess) {
    const { data: place, error } = await admin.from('locations').select('id, brand_id').eq('id', locationId).maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!place || place.brand_id !== brandAccess.brandId) {
      return NextResponse.json({ error: 'El lugar seleccionado no existe.' }, { status: 404 })
    }
  }

  const { data: last } = await admin
    .from('campaign_locations').select('sort_order').eq('campaign_id', params.id)
    .order('sort_order', { ascending: false }).limit(1).maybeSingle()

  const { data: created, error: insertError } = await admin
    .from('campaign_locations')
    .insert({
      campaign_id: params.id,
      location_id: locationId,
      instructions: instructions.value,
      sort_order: (last?.sort_order ?? -1) + 1,
      created_by: userId,
    })
    .select('id')
    .single()
  if (insertError) {
    const e = campaignLocationDbError(insertError)
    return NextResponse.json({ error: e.error }, { status: e.status })
  }

  try {
    if (body?.is_primary === true) {
      const { error } = await admin.rpc('campaign_locations_set_primary', { p_campaign_id: params.id, p_link_id: created.id })
      if (error) throw new Error(error.message)
    }
    const data = await syncCampaignPrimaryLocation(admin, params.id)
    return NextResponse.json({ data }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: `La dirección se guardó, pero no se pudo actualizar el calendario y la ficha (${error instanceof Error ? error.message : 'error desconocido'}). Reintenta: la sincronización es idempotente.` }, { status: 500 })
  }
}
