import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { PLAN_TIERS, resolveBrandPlan } from '@/lib/plan-limits'

type Params = { params: { id: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: brand, error: brandError } = await admin
    .from('brands')
    .select('*')
    .eq('id', params.id)
    .single()

  if (brandError) {
    if (brandError.code === 'PGRST116') return NextResponse.json({ error: 'Brand not found' }, { status: 404 })
    return NextResponse.json({ error: brandError.message }, { status: 500 })
  }

  const { data: primaryCampaigns } = await admin
    .from('campaigns')
    .select('id, name, status, budget_total, currency, created_at')
    .eq('brand_id', params.id)
    .order('created_at', { ascending: false })

  const { data: coBrandRows } = await admin
    .from('campaign_brands')
    .select('campaigns(id, name, status, budget_total, currency, created_at)')
    .eq('brand_id', params.id)

  const campaigns = [
    ...(primaryCampaigns ?? []),
    ...((coBrandRows ?? []).map((r: any) => r.campaigns).filter(Boolean)),
  ]

  const uniqueCampaigns = Array.from(new Map(campaigns.map((c: any) => [c.id, c])).values())

  // Última conexión — mismo criterio que GET /api/brands (lista): se lee de
  // auth.users porque brands no tiene columna propia de último acceso.
  let last_sign_in_at: string | null = null
  if (brand.user_id) {
    const { data: u } = await admin.auth.admin.getUserById(brand.user_id)
    last_sign_in_at = u?.user?.last_sign_in_at ?? null
  }

  // Plan interno efectivo individual de la marca.
  const org_plan = brand.organization_id
    ? await resolveBrandPlan(admin, brand.organization_id, brand.id)
    : 'basic'

  // Influencers agregadas/asignadas directamente a esta marca vía brand_influencers
  // (además de las que vienen por campañas, que el cliente resuelve aparte).
  // Usado por el tab "Influencers" del detalle de marca en admin.
  const { data: directRows } = await admin
    .from('brand_influencers')
    .select('influencer:influencers(id, display_name, avatar_url)')
    .eq('brand_id', params.id)

  const direct_influencers = ((directRows ?? [])
    .map(r => r.influencer)
    .filter(Boolean)) as unknown as Array<{ id: string; display_name: string; avatar_url: string | null }>

  return NextResponse.json({ data: { ...brand, campaigns: uniqueCampaigns, last_sign_in_at, org_plan, direct_influencers } })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { id: _id, organization_id: _oi, created_by: _cb, created_at: _ca, ...rest } = body

  if ('subscription_plan_override' in rest) {
    const rawValue = rest.subscription_plan_override
    const normalized =
      rawValue === null || rawValue === undefined || rawValue === ''
        ? null
        : String(rawValue).toLowerCase().trim()

    if (
      normalized !== null &&
      !(PLAN_TIERS as readonly string[]).includes(normalized)
    ) {
      return NextResponse.json(
        { error: 'El plan debe ser basic, growth, pro o heredar' },
        { status: 422 },
      )
    }

    rest.subscription_plan_override = normalized
  }

  const { data, error } = await admin
    .from('brands')
    .update({ ...rest, updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Auto-asignación de marca colaboradora tras aprobación (2026-07-12, pedido
  // de Pri): si esta marca fue creada desde el flujo de "marcas colaboradoras"
  // (POST /api/campaigns/[id]/brands con email nuevo) quedó marcada en
  // metadata.pending_collab_campaign_id, SIN asignar todavía. Recién ahora que
  // Admin la aprueba se la asigna a esa campaña — nunca antes. Idempotente: se
  // limpia la metadata apenas se usa, así un PATCH posterior no la reasigna.
  const meta = (data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata))
    ? (data.metadata as Record<string, unknown>)
    : {}
  const pendingCampaignId = meta.pending_collab_campaign_id as string | undefined

  if (data.status === 'approved' && pendingCampaignId) {
    try {
      const { error: assignError } = await admin
        .from('campaign_brands')
        .upsert({
          campaign_id: pendingCampaignId,
          brand_id: data.id,
          role: 'collaborator',
          assigned_by: user.id,
        }, { onConflict: 'campaign_id,brand_id' })

      if (assignError) {
        console.error('[PATCH /api/brands/[id]] auto-asignación de co-marca falló:', assignError.message)
      } else {
        const { pending_collab_campaign_id: _drop1, invited_by_brand_id: _drop2, ...restMeta } = meta
        await admin.from('brands').update({ metadata: restMeta }).eq('id', data.id)
      }
    } catch (e) {
      console.error('[PATCH /api/brands/[id]] auto-asignación de co-marca — error no bloqueante:', e)
    }
  }

  const org_plan = data.organization_id
    ? await resolveBrandPlan(admin, data.organization_id, data.id)
    : 'basic'

  return NextResponse.json({ data: { ...data, org_plan } })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { error } = await admin
    .from('brands')
    .delete()
    .eq('id', params.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
