import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { fetchDeliverablePostMetrics, computeEngagementRate } from '@/lib/deliverables/apify-metrics'

type Params = { params: { id: string } }

/**
 * POST /api/campaign-deliverables/[id]/sync-metrics
 * Trae métricas reales (views/likes/comments) del link publicado del
 * deliverable usando Apify, y las guarda en campaign_deliverables.performance.
 *
 * Permisos:
 *  - admin (sin is_brand/is_influencer): cualquier deliverable.
 *  - marca: solo deliverables de campañas propias (dueña o co-marca).
 *  - influencer: solo sus propios deliverables.
 *
 * No inventa reach/impressions/saves/shares — si Apify no las entrega,
 * quedan fuera del JSONB guardado (ver src/lib/deliverables/apify-metrics.ts).
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: deliverable, error: fetchErr } = await admin
    .from('campaign_deliverables')
    .select('id, campaign_id, influencer_id, published_url, content_url, campaign:campaigns(id, brand_id)')
    .eq('id', params.id)
    .single()

  if (fetchErr || !deliverable) {
    return NextResponse.json({ error: 'Deliverable no encontrado' }, { status: 404 })
  }

  // ── Permisos por portal ──────────────────────────────────────────────────
  if (user.user_metadata?.is_influencer) {
    const { data: influencer } = await admin
      .from('influencers')
      .select('id')
      .eq('user_id', user.id)
      .single()

    if (!influencer || deliverable.influencer_id !== influencer.id) {
      return NextResponse.json({ error: 'No tienes acceso a este deliverable' }, { status: 403 })
    }
  } else if (user.user_metadata?.is_brand) {
    const metaBrandId = user.user_metadata?.brand_id as string | undefined
    let brandQuery = admin.from('brands').select('id').limit(1)
    brandQuery = metaBrandId ? brandQuery.eq('id', metaBrandId) : brandQuery.eq('user_id', user.id)
    const { data: brand } = await brandQuery.maybeSingle()

    if (!brand) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })

    const campaignRaw = deliverable.campaign as unknown
    const campaign = (Array.isArray(campaignRaw) ? campaignRaw[0] : campaignRaw) as
      { id: string; brand_id: string | null } | null | undefined
    const isOwner = campaign?.brand_id === brand.id
    let isCoBrand = false
    if (!isOwner && campaign) {
      const { data: coBrand } = await admin
        .from('campaign_brands')
        .select('campaign_id')
        .eq('campaign_id', campaign.id)
        .eq('brand_id', brand.id)
        .maybeSingle()
      isCoBrand = !!coBrand
    }
    if (!isOwner && !isCoBrand) {
      return NextResponse.json({ error: 'No tienes acceso a este deliverable' }, { status: 403 })
    }
  }
  // Admin (sin is_brand/is_influencer): sin restricción adicional.

  const url = deliverable.published_url || deliverable.content_url
  if (!url) {
    return NextResponse.json({ error: 'Este deliverable todavía no tiene link de publicación' }, { status: 422 })
  }

  const result = await fetchDeliverablePostMetrics(url)
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 502 })
  }

  // Fallback de engagement: seguidores de Instagram del influencer, solo si
  // Apify no devolvió views (ej. post de imagen sin reproducciones).
  let followersFallback: number | null = null
  if (deliverable.influencer_id) {
    const { data: profile } = await admin
      .from('influencer_social_profiles')
      .select('followers')
      .eq('influencer_id', deliverable.influencer_id)
      .eq('platform', 'instagram')
      .maybeSingle()
    followersFallback = profile?.followers ?? null
  }

  const engagementRate = computeEngagementRate(result.data, followersFallback)
  const now = new Date().toISOString()

  const { data, error } = await admin
    .from('campaign_deliverables')
    .update({
      performance: {
        views:    result.data.views,
        likes:    result.data.likes,
        comments: result.data.comments,
      },
      metrics_provider:    'apify',
      metrics_updated_at:  now,
      engagement_rate:     engagementRate,
      updated_at:          now,
    })
    .eq('id', params.id)
    .select('id, performance, metrics_provider, metrics_updated_at, engagement_rate')
    .single()

  if (error) {
    console.error('[POST /api/campaign-deliverables/[id]/sync-metrics]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data })
}
