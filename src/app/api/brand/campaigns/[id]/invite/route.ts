import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'

type Params = { params: { id: string } }

// POST /api/brand-campaigns/[id]/invite
// La marca invita a un influencer a una campaña (private u open).
// Crea campaign_influencers con origin='invitation', application_status='pending'.
// Los deliverables se crean automáticamente cuando el influencer acepta (PATCH applications).
export async function POST(req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!user.user_metadata?.is_brand) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()

  // Verificar que la campaña pertenece a esta marca
  const { data: brand } = await admin
    .from('brands')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!brand) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })

  const { data: campaign } = await admin
    .from('campaigns')
    .select('id, status, brand_id, organization_id')
    .eq('id', params.id)
    .eq('brand_id', brand.id)
    .single()

  if (!campaign) return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })
  if (campaign.status === 'completed' || campaign.status === 'canceled') {
    return NextResponse.json({ error: 'No se puede invitar a una campaña finalizada' }, { status: 422 })
  }

  let body: {
    influencer_id: string
    proposed_fee?: number
    message?: string
    deliverables_spec?: Array<{
      type: string
      quantity: number
      platform?: string
      due_date?: string
    }>
  }

  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { influencer_id, proposed_fee, message, deliverables_spec } = body

  if (!influencer_id) return NextResponse.json({ error: 'influencer_id requerido' }, { status: 422 })

  // Verificar que el influencer pertenece a la misma org
  const { data: influencer } = await admin
    .from('influencers')
    .select('id')
    .eq('id', influencer_id)
    .eq('organization_id', campaign.organization_id)
    .eq('is_active', true)
    .single()

  if (!influencer) return NextResponse.json({ error: 'Influencer no encontrado o inactivo' }, { status: 404 })

  // Verificar que no haya invitación previa
  const { data: existing } = await admin
    .from('campaign_influencers')
    .select('id, application_status')
    .eq('campaign_id', params.id)
    .eq('influencer_id', influencer_id)
    .single()

  if (existing) {
    return NextResponse.json({
      error: existing.application_status === 'pending'
        ? 'Ya existe una invitación pendiente para este influencer'
        : 'Este influencer ya tiene una relación activa con la campaña',
    }, { status: 422 })
  }

  // Crear invitación con nuevo schema
  const { data, error } = await admin
    .from('campaign_influencers')
    .insert({
      campaign_id:        params.id,
      influencer_id,
      application_status: 'pending',
      origin:             'invitation',
      fee:                proposed_fee ?? null,
      message:            message ?? null,
      deliverables_spec:  deliverables_spec ? JSON.stringify(deliverables_spec) : '[]',
    })
    .select('id, application_status, origin, fee')
    .single()

  if (error) {
    console.error('[POST /api/brand-campaigns/[id]/invite]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data }, { status: 201 })
}
