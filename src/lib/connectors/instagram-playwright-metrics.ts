/**
 * Fallback propio de métricas de Instagram (post/reel) vía scraping con
 * Playwright + Chromium serverless (@sparticuz/chromium) — sin costo por
 * request, sin token de terceros. Se usa SOLO cuando Apify no está
 * disponible (sin token, sin créditos, o error) — ver fetch-metrics.ts.
 *
 * NO requiere login ni cuenta de Instagram. Lee metadatos públicos que
 * Instagram ya expone en el HTML server-rendered de cualquier post/reel
 * público (tags og:title / og:description, texto visible de la página).
 *
 * Riesgo real y esperado: Instagram bloquea agresivamente tráfico de
 * datacenter sin sesión. Esto va a fallar a veces (redirect a login,
 * cambio de estructura del HTML) — cuando falla, devuelve {error}, NUNCA
 * inventa un número. Es "mejor esfuerzo", no reemplazo garantizado de
 * Apify.
 */

import { randomUUID } from 'crypto'
import { readdirSync, rmSync } from 'fs'
import path from 'path'
import type { Browser, Route } from 'playwright-core'
import type { DeliverableMetrics, DeliverableMetricsResult } from '../deliverables/metrics-types'

const NAV_TIMEOUT_MS = 20_000
const OVERALL_TIMEOUT_MS = 45_000

// Vercel reutiliza el mismo contenedor ("warm") entre invocaciones, y /tmp
// persiste entre ellas. Chromium no siempre limpia su directorio de perfil
// temporal al cerrar (ver github.com/Sparticuz/chromium/issues/231) -- con
// varias sincronizaciones seguidas /tmp se llena y page.goto empieza a
// tirar "ERR_INSUFFICIENT_RESOURCES" aunque el link sea válido. Se barre
// cualquier perfil de una corrida anterior antes de lanzar uno nuevo
// (auto-healing, no depende de que el cierre previo haya sido limpio) y
// cada corrida usa su propio directorio.
const TMP_PROFILE_PREFIX = 'pw-profile-'

function cleanupStaleProfiles() {
  try {
    for (const entry of readdirSync('/tmp')) {
      if (entry.startsWith(TMP_PROFILE_PREFIX)) {
        rmSync(path.join('/tmp', entry), { recursive: true, force: true })
      }
    }
  } catch {
    // /tmp no legible o vacío -- no es fatal
  }
}

function parseCompactNumber(raw: string): number | null {
  const cleaned = raw.trim().replace(/,/g, '')
  const m = cleaned.match(/^([\d.]+)\s*([KMkm]?)$/)
  if (!m) return null
  const n = parseFloat(m[1])
  if (Number.isNaN(n)) return null
  const suffix = m[2].toUpperCase()
  if (suffix === 'K') return Math.round(n * 1_000)
  if (suffix === 'M') return Math.round(n * 1_000_000)
  return Math.round(n)
}

function extractShortcode(url: string): string | null {
  const m = url.match(/instagram\.com\/(?:[^/]+\/)?(?:p|reel|reels)\/([A-Za-z0-9_-]+)/i)
  return m ? m[1] : null
}

async function launchBrowser() {
  const isVercel = !!process.env.VERCEL
  const { chromium } = await import('playwright-core')

  if (isVercel) {
    cleanupStaleProfiles()
    const chromiumBinary = (await import('@sparticuz/chromium')).default
    const userDataDir = path.join('/tmp', `${TMP_PROFILE_PREFIX}${randomUUID()}`)
    return chromium.launch({
      args: [...chromiumBinary.args, `--user-data-dir=${userDataDir}`],
      executablePath: await chromiumBinary.executablePath(),
      headless: true,
    })
  }

  // Local dev (no /var/task de Lambda): usa el Chromium que Playwright
  // instala en el cache global del sistema. Requiere correr una vez
  // `npx playwright install chromium` en la máquina.
  return chromium.launch({ headless: true })
}

export async function fetchInstagramMetricsViaPlaywright(url: string): Promise<DeliverableMetricsResult> {
  const shortcode = extractShortcode(url)
  if (!shortcode) {
    return { error: 'URL no parece ser un post/reel de Instagram válido' }
  }

  let browser: Browser | null = null

  try {
    // Se lanza afuera de la carrera contra el timeout, en el flujo
    // síncrono de esta función (no dentro de la closure de abajo) — así
    // TypeScript puede rastrear la reasignación de `browser` para el
    // cierre en el finally sin quedar mal tipado.
    browser = await launchBrowser()
    const activeBrowser = browser

    const result = await Promise.race([
      (async (): Promise<DeliverableMetricsResult> => {
        const context = await activeBrowser.newContext({
          userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          viewport: { width: 1280, height: 900 },
          locale: 'en-US',
        })

        // No necesitamos imágenes/fuentes/medios para leer metadatos de texto
        // — bajar esto reduce memoria y tiempo en un entorno con RAM acotada.
        await context.route('**/*', (route: Route) => {
          const type = route.request().resourceType()
          if (type === 'image' || type === 'media' || type === 'font') return route.abort()
          return route.continue()
        })

        const page = await context.newPage()
        page.setDefaultTimeout(NAV_TIMEOUT_MS)

        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS })

        const finalUrl = page.url()
        if (/\/accounts\/login/i.test(finalUrl) || (response && response.status() === 429)) {
          return { error: 'Instagram bloqueó la solicitud (redirect a login o rate limit)' }
        }

        const ogDescription = await page.locator('meta[property="og:description"]').first().getAttribute('content').catch(() => null)
        const ogTitle = await page.locator('meta[property="og:title"]').first().getAttribute('content').catch(() => null)

        let likes: number | null = null
        let comments: number | null = null

        // Formato clásico de Instagram: "1,234 Likes, 56 Comments - user on Instagram: ..."
        if (ogDescription) {
          const likesMatch = ogDescription.match(/([\d.,]+[KM]?)\s+Likes?/i)
          const commentsMatch = ogDescription.match(/([\d.,]+[KM]?)\s+Comments?/i)
          if (likesMatch) likes = parseCompactNumber(likesMatch[1])
          if (commentsMatch) comments = parseCompactNumber(commentsMatch[1])
        }

        // Views/plays (reels) — no siempre está en meta tags, se busca en el
        // texto visible de la página como último recurso.
        let views: number | null = null
        try {
          const bodyText = await page.locator('body').innerText({ timeout: 5000 })
          const viewsMatch = bodyText.match(/([\d.,]+[KM]?)\s+(?:views|plays)/i)
          if (viewsMatch) views = parseCompactNumber(viewsMatch[1])
        } catch {
          // sin texto legible a tiempo — no es fatal, sigue sin views
        }

        if (likes === null && comments === null && views === null) {
          return {
            error: ogTitle
              ? 'No se encontraron métricas en la página (puede ser un post privado o formato no reconocido)'
              : 'Página vacía o bloqueada — no se pudo leer contenido',
          }
        }

        const data: DeliverableMetrics = { views, likes, comments }
        return { data }
      })(),
      new Promise<DeliverableMetricsResult>(resolve =>
        setTimeout(() => resolve({ error: 'Timeout scrapeando Instagram (>45s)' }), OVERALL_TIMEOUT_MS)
      ),
    ])

    return result
  } catch (e) {
    return { error: `Error scrapeando Instagram: ${(e as Error).message}` }
  } finally {
    if (browser) {
      try { await browser.close() } catch { /* noop */ }
    }
  }
}
