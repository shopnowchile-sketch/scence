import type { DeliverableMetrics, MetricsProvider } from './metrics-types'
import { fetchDeliverablePostMetrics } from './apify-metrics'
import { fetchInstagramMetricsViaPlaywright } from '../connectors/instagram-playwright-metrics'
import { hasUsableMetrics } from './metrics-state'

export type FetchMetricsResult =
  | { provider: MetricsProvider; data: DeliverableMetrics }
  | { error: string }

/**
 * Orquestador de proveedores de métricas — orden de prioridad:
 *
 *  1. instagram-api  — RESERVADO. Se activaría acá cuando el influencer
 *     dueño del deliverable tenga su cuenta de Instagram Business/Creator
 *     conectada vía Meta OAuth (instagram_manage_insights). No implementado
 *     todavía a propósito: requiere flujo de conexión + Meta App Review,
 *     fuera de alcance de este sprint. Cuando exista, entra acá arriba de
 *     Apify sin tocar el resto de este archivo ni el endpoint que lo llama.
 *  2. apify           — actual, requiere APIFY_API_TOKEN con créditos.
 *  3. playwright       — fallback propio, scraping best-effort, gratis.
 *
 * Si todos fallan, se devuelve el último error (ninguno inventa datos).
 */
export async function fetchMetricsWithFallback(url: string): Promise<FetchMetricsResult> {
  // 1. instagram-api — TODO cuando exista integración oficial por influencer.

  // 2. Apify
  const apifyResult = await fetchDeliverablePostMetrics(url)
  if ('data' in apifyResult && hasUsableMetrics(apifyResult.data)) {
    return { provider: 'apify', data: apifyResult.data }
  }
  const apifyError = 'error' in apifyResult
    ? apifyResult.error
    : 'no devolvió métricas utilizables'

  // 3. Fallback propio (Playwright) — solo se intenta si Apify falló
  // (sin token, sin créditos, actor caído, etc.)
  const playwrightResult = await fetchInstagramMetricsViaPlaywright(url)
  if ('data' in playwrightResult && hasUsableMetrics(playwrightResult.data)) {
    return { provider: 'playwright', data: playwrightResult.data }
  }
  const playwrightError = 'error' in playwrightResult
    ? playwrightResult.error
    : 'no devolvió métricas utilizables'

  return { error: `Apify: ${apifyError} · Playwright: ${playwrightError}` }
}
