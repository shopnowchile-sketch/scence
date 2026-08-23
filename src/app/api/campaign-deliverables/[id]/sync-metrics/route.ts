import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { computeEngagementRateDetails } from '@/lib/deliverables/apify-metrics'
import { fetchMetricsWithFallback } from '@/lib/deliverables/fetch-metrics'
import { getOrgId, getUserRole, hasBrandPermission, resolveBrandAccess } from '@/lib/supabase/ensureOrg'
import type { DeliverablePerformance } from '@/lib/deliverables/metrics-types'
import { getDeliverableMetricsUrl, losesValidMetricForCurrentContent } from '@/lib/deliverables/metrics-state'

type Params = { params: { id: string } }

// Puede lanzar Chromium (fallback Playwright) — necesita más que el default.
export const maxDuration = 60

/**
 * POST /api/campaign-deliverables/[id]/sync-metrics
 * Trae métricas reales (views/likes/comments) del link publicado del
 * deliverable y las guarda en campaign_deliverables.performance.
 *
 * Proveedor: Apify primero; si falla (sin token, sin créditos, error),
 * fallback automático a scraping propio con Playwright — ver
 * src/lib/deliverables/fetch-metrics.ts para el orden de prioridad
 * completo (incluye el slot reservado para Instagram API oficial).
 *
 * Permisos:
 *  - admin (sin is_brand/is_influencer): cualquier deliverable.
 *  - marca: solo deliverables de campañas propias (dueña o co-marca).
 *  - influencer: solo sus propios deliverables.
 *
 * No inventa reach/impressions/saves/shares — si ningún proveedor las
 * entrega, quedan fuera del JSONB guardado.
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: deliverable, error: fetchErr } = await admin
    .from('campaign_deliverables')
    .select('id, type, campaign_id, influencer_id, published_url, content_url, performance, campaign:campaigns(id, brand_id)')
    .eq('id', params.id)
    .single()

  if (fetchErr || !deliverable) {
    return NextResponse.json({ error: 'Deliverable no encontrado' }, { status: 404 })
  }

  if (!['reel', 'post'].includes(deliverable.type)) {
    return NextResponse.json({ error: 'Las Stories y entregables de cumplimiento no usan métricas de rendimiento.' }, { status: 422 })
  }

  // ── Permisos por portal ──────────────────────────────────────────────────
  const [{ data: influencer }, brandAccess] = await Promise.all([
    admin.from('influencers').select('id').eq('user_id', user.id).maybeSingle(),
    resolveBrandAccess(user.id),
  ])

  if (influencer) {
    if (deliverable.influencer_id !== influencer.id) {
      return NextResponse.json({ error: 'No tienes acceso a este deliverable' }, { status: 403 })
    }
  } else if (brandAccess) {
    if (!hasBrandPermission(brandAccess, 'campaign.manage')) {
      return NextResponse.json({ error: 'No tienes permisos para actualizar métricas' }, { status: 403 })
    }
    const campaignRaw = deliverable.campaign as unknown
    const campaign = (Array.isArray(campaignRaw) ? campaignRaw[0] : campaignRaw) as
      { id: string; brand_id: string | null } | null | undefined
    const isOwner = campaign?.brand_id === brandAccess.brandId
    let isCoBrand = false
    if (!isOwner && campaign) {
      const { data: coBrand } = await admin
        .from('campaign_brands')
        .select('campaign_id')
        .eq('campaign_id', campaign.id)
        .eq('brand_id', brandAccess.brandId)
        .maybeSingle()
      isCoBrand = !!coBrand
    }
    if (!isOwner && !isCoBrand) {
      return NextResponse.json({ error: 'No tienes acceso a este deliverable' }, { status: 403 })
    }
  } else {
    const orgId = await getOrgId(user.id, undefined, admin)
    const isAdmin = orgId ? (await getUserRole(user.id, orgId, admin)).isAdmin : false
    if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = getDeliverableMetricsUrl(deliverable.content_url, deliverable.published_url)
  if (!url) {
    return NextResponse.json({ error: 'Este deliverable todavía no tiene link de publicación' }, { status: 422 })
  }

  const result = await fetchMetricsWithFallback(url)
  if ('error' in result) {
    console.warn('[sync-metrics] ningún proveedor pudo obtener métricas:', result.error)
    return NextResponse.json({
      error: 'No pudimos obtener métricas para este contenido. Puede ser privado, haber sido eliminado o estar temporalmente limitado por Instagram. El link y las métricas válidas existentes no fueron modificados.',
    }, { status: 502 })
  }

  // Una respuesta parcial puede ser un bloqueo temporal de Instagram. Si ya
  // había un valor válido para el mismo URL, no lo reemplazamos por null.
  const previousPerformance = deliverable.performance as (
    Partial<Record<'views' | 'likes' | 'comments', unknown>> & { source_url?: unknown }
  ) | null
  const lostPreviouslyValidMetric = losesValidMetricForCurrentContent(previousPerformance, result.data, url)
  if (lostPreviouslyValidMetric) {
    return NextResponse.json({
      error: 'Instagram devolvió métricas incompletas temporalmente. Conservamos los valores válidos anteriores; intenta actualizar nuevamente más tarde.',
    }, { status: 502 })
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

  const engagement = computeEngagementRateDetails(result.data, followersFallback)
  const now = new Date().toISOString()

  const performance: DeliverablePerformance = {
    views:    result.data.views,
    likes:    result.data.likes,
    comments: result.data.comments,
    source_url: url,
    engagement_rate_calculation: engagement.basis && engagement.denominator != null
      ? {
          source: 'internal',
          basis: engagement.basis,
          denominator: engagement.denominator,
          formula: '(likes + comments) / denominator * 100',
        }
      : null,
  }

  // La consulta a Instagram puede tardar. Condicionar el UPDATE a ambos URLs
  // evita que una respuesta iniciada con un link antiguo repueble métricas
  // después de que la influencer haya cambiado el contenido.
  let updateQuery = admin
    .from('campaign_deliverables')
    .update({
      performance,
      metrics_provider:    result.provider,
      metrics_updated_at:  now,
      engagement_rate:     engagement.rate,
      updated_at:          now,
    })
    .eq('id', params.id)

  updateQuery = deliverable.content_url == null
    ? updateQuery.is('content_url', null)
    : updateQuery.eq('content_url', deliverable.content_url)
  updateQuery = deliverable.published_url == null
    ? updateQuery.is('published_url', null)
    : updateQuery.eq('published_url', deliverable.published_url)

  const { data, error } = await updateQuery
    .select('id, performance, metrics_provider, metrics_updated_at, engagement_rate')
    .maybeSingle()

  if (error) {
    console.error('[POST /api/campaign-deliverables/[id]/sync-metrics]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!data) {
    return NextResponse.json({
      error: 'El link cambió mientras se obtenían las métricas. No guardamos resultados del contenido anterior; vuelve a sincronizar el link actual.',
    }, { status: 409 })
  }

  return NextResponse.json({ data })
}
