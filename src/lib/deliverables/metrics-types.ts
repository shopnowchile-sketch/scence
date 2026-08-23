/**
 * Tipos compartidos entre TODOS los proveedores de métricas de deliverables
 * (Apify, Playwright propio, y a futuro Instagram API oficial). Un solo
 * shape de salida para que el endpoint de sync-metrics no le importe de
 * dónde vinieron los datos.
 */

export interface DeliverableMetrics {
  views: number | null
  likes: number | null
  comments: number | null
}

export type EngagementRateBasis = 'views' | 'followers'

/**
 * Shape persistido en `campaign_deliverables.performance`.
 *
 * Las tres métricas originales se mantienen intactas para no romper reportes
 * ni consumidores existentes. Los campos opcionales sólo aportan trazabilidad:
 * qué URL se consultó y cómo se calculó el engagement rate.
 */
export interface DeliverablePerformance extends DeliverableMetrics {
  source_url?: string
  engagement_rate_calculation?: {
    source: 'internal'
    basis: EngagementRateBasis
    denominator: number
    formula: '(likes + comments) / denominator * 100'
  } | null
}

export type DeliverableMetricsResult =
  | { data: DeliverableMetrics }
  | { error: string }

// 'instagram-api' está reservado para cuando exista integración oficial
// (influencer conecta su cuenta Business/Creator vía Meta OAuth) — no hay
// código de ese proveedor todavía, pero el tipo ya lo contempla para no
// tener que tocar `metrics_provider` (columna text, sin constraint) ni el
// tipo de nuevo cuando se agregue.
export type MetricsProvider = 'instagram-api' | 'apify' | 'playwright'
