import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'

type Params = { params: { id: string } }

// POST /api/influencer/campaigns/[id]/apply
// Influencer postula a una campaña open — crea campaign_influencers con application_status='pending', origin='application'
export async function POST(req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: influencer } = await admin
    .from('influencers')
    .select('id, organization_id')
    .eq('user_id', user.id)
    .single()
  if (!influencer) return NextResponse.json({ error: 'Not an influencer account' }, { status: 403 })

  // Verificar que la campaña existe, es open y está activa o en pending_influencers
  const { data: campaign } = await admin
    .from('campaigns')
    .select('id, name, status, visibility, organization_id, application_deadline')
    .eq('id', params.id)
    .eq('organization_id', influencer.organization_id)
    .single()

  if (!campaign) return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })
  if (campaign.visibility !== 'open') return NextResponse.json({ error: 'Esta campaña no está abierta a postulaciones' }, { status: 422 })
  if (!['active', 'pending_influencers', 'draft'].includes(campaign.status)) {
    return NextResponse.json({ error: 'Esta campaña no acepta postulaciones en este momento' }, { status: 422 })
  }
  if (campaign.application_deadline && new Date(campaign.application_deadline) < new Date()) {
    return NextResponse.json({ error: 'El plazo de postulación ha cerrado' }, { status: 422 })
  }

  // Verificar que no haya postulación previa
  const { data: existing } = await admin
    .from('campaign_influencers')
    .select('id, application_status')
    .eq('campaign_id', params.id)
    .eq('influencer_id', influencer.id)
    .single()

  if (existing) {
    return NextResponse.json({
      error: existing.application_status === 'pending'
        ? 'Ya enviaste una postulación a esta campaña'
        : 'Ya tienes una relación activa con esta campaña',
    }, { status: 422 })
  }

  // Leer mensaje opcional del body
  let message: string | null = null
  try {
    const body = await req.json()
    message = body?.message ?? null
  } catch { /* body vacío es ok */ }

  // Crear postulación con nuevo schema
  const { data, error } = await admin
    .from('campaign_influencers')
    .insert({
      campaign_id:        params.id,
      influencer_id:      influencer.id,
      application_status: 'pending',
      origin:             'application',
      message:            message,
      fee:                null,
      deliverables_spec:  '[]',
    })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, id: data.id })
}

// DELETE /api/influencer/campaigns/[id]/apply — cancel application
export async function DELETE(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: influencer } = await admin
    .from('influencers').select('id').eq('user_id', user.id).single()
  if (!influencer) return NextResponse.json({ error: 'Not an influencer account' }, { status: 403 })

  await admin
    .from('campaign_influencers')
    .delete()
    .eq('campaign_id', params.id)
    .eq('influencer_id', influencer.id)
    .eq('application_status', 'pending')
    .eq('origin', 'application')

  return NextResponse.json({ ok: true })
}
