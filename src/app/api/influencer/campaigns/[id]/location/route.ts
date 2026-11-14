import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { isUuid } from '@/lib/influencer-shipping'

type Params = { params: { id: string } }

// PATCH /api/influencer/campaigns/[id]/location — Body: { location_id }
// Con varias sucursales, la influencer ACEPTADA elige dónde asistirá. Con una sola, es obligatoria
// y no hay nada que elegir. Solo se acepta un lugar ya asociado a la campaña (campaign_locations).
// Se guarda en campaign_influencers.metadata.attendance_location_id (sin tocar la campaña ni su historial).
export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null)
  if (!isUuid(params.id) || !isUuid(body?.location_id)) return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })

  const admin = createAdminClient()
  const { data: inf } = await admin.from('influencers').select('id').eq('user_id', user.id).maybeSingle()
  if (!inf) return NextResponse.json({ error: 'Not an influencer' }, { status: 403 })

  const { data: ci } = await admin.from('campaign_influencers').select('id, metadata')
    .eq('campaign_id', params.id).eq('influencer_id', inf.id).eq('application_status', 'accepted').maybeSingle()
  if (!ci) return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })

  const { data: links } = await admin.from('campaign_locations').select('location_id').eq('campaign_id', params.id)
  const options = (links ?? []).map(l => l.location_id as string)
  if (options.length < 2) return NextResponse.json({ error: 'La campaña tiene una única ubicación obligatoria.' }, { status: 422 })
  if (!options.includes(body.location_id)) return NextResponse.json({ error: 'Ubicación no disponible en esta campaña.' }, { status: 404 })

  const metadata = { ...((ci.metadata && typeof ci.metadata === 'object') ? ci.metadata as Record<string, unknown> : {}), attendance_location_id: body.location_id }
  const { error } = await admin.from('campaign_influencers').update({ metadata }).eq('id', ci.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
