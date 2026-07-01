import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'

type Params = { params: { id: string } }

// GET /api/influencer/campaigns/[id]
// Preview de una campaña ANTES de postular (botón "Ver detalles" desde
// "Campañas Disponibles"). Reutiliza la misma regla de visibilidad que
// /api/influencer/campaigns/open y /apply: visibility='open' + misma org,
// o bien la influencer ya tiene una fila en campaign_influencers (invitada
// o ya postulando) — en ese caso puede ver el detalle igual aunque la
// campaña sea privada.
export async function GET(_req: NextRequest, { params }: Params) {
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

  const { data: campaign, error } = await admin
    .from('campaigns')
    .select(`
      id, name, description, content_guidelines, type, status, visibility,
      start_date, end_date, budget_total, currency, hashtags, platforms,
      deliverable_templates, application_deadline, max_influencers,
      brand:brands!brand_id (id, name, logo_url, website)
    `)
    .eq('id', params.id)
    .eq('organization_id', influencer.organization_id)
    .single()

  if (error || !campaign) return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })

  const { data: existing } = await admin
    .from('campaign_influencers')
    .select('id, application_status')
    .eq('campaign_id', params.id)
    .eq('influencer_id', influencer.id)
    .maybeSingle()

  if (!existing && campaign.visibility !== 'open') {
    return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })
  }

  return NextResponse.json({
    data: {
      ...campaign,
      _applied: !!existing,
      application_status: existing?.application_status ?? null,
    },
  })
}
