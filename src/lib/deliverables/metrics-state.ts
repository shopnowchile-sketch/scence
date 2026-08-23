import type { DeliverableMetrics } from './metrics-types'

const METRIC_KEYS = ['views', 'likes', 'comments'] as const

export function normalizeContentUrl(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() || null : null
}

export function didContentUrlChange(currentUrl: unknown, nextUrl: unknown): boolean {
  return normalizeContentUrl(currentUrl) !== normalizeContentUrl(nextUrl)
}

export function getDeliverableMetricsUrl(contentUrl: unknown, publishedUrl: unknown): string | null {
  return normalizeContentUrl(contentUrl) ?? normalizeContentUrl(publishedUrl)
}

export function hasUsableMetrics(metrics: DeliverableMetrics): boolean {
  const values = METRIC_KEYS.map(key => metrics[key])
  const allValid = values.every(value =>
    value == null || (typeof value === 'number' && Number.isFinite(value) && value >= 0)
  )
  return allValid && values.some(value => value != null)
}

export function losesPreviouslyValidMetric(
  previous: Partial<Record<(typeof METRIC_KEYS)[number], unknown>> | null,
  next: DeliverableMetrics,
): boolean {
  return METRIC_KEYS.some(key =>
    next[key] == null
    && typeof previous?.[key] === 'number'
    && Number.isFinite(previous[key])
    && previous[key] >= 0
  )
}

export function losesValidMetricForCurrentContent(
  previous: (Partial<Record<(typeof METRIC_KEYS)[number], unknown>> & { source_url?: unknown }) | null,
  next: DeliverableMetrics,
  currentUrl: unknown,
): boolean {
  const previousSourceUrl = normalizeContentUrl(previous?.source_url)
  const normalizedCurrentUrl = normalizeContentUrl(currentUrl)

  // Los registros históricos no tienen source_url. En ese caso se consideran
  // pertenecientes al link actual porque el cambio de URL ya invalida
  // performance en el submit. Si existe source_url, debe coincidir.
  if (previousSourceUrl && previousSourceUrl !== normalizedCurrentUrl) return false

  return losesPreviouslyValidMetric(previous, next)
}
