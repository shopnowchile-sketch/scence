/**
 * Métricas reales de una publicación (post/reel) a partir de su link,
 * usando los actores OFICIALES de Apify (mismo publisher que ya usamos en
 * src/lib/influencers/apify.ts, mismo APIFY_API_TOKEN — no es una integración
 * nueva de cero, es la extensión de la misma).
 *
 * Aprobado por Pri: "Partimos con métricas reales disponibles: views, likes
 * y comments. Reach, impressions, saves y shares quedan fuera hasta tener
 * una fuente privada/real." No se inventan esos campos.
 *
 * Actor usado según el tipo de link:
 *  - .../reel/...  -> apify/instagram-reel-scraper
 *  - cualquier otro (post, carrusel) -> apify/instagram-post-scraper
 *
 * Ambos actores aceptan una URL directa de post/reel en su input `username`
 * (confirmado en su input schema — es un array que acepta username, URL de
 * perfil, o URL de post/reel puntual).
 *
 * Se usa el endpoint síncrono de Apify (run-sync-get-dataset-items) porque
 * acá se sincroniza 1 link a la vez desde un botón manual — no hace falta
 * el patrón de polling que sí usamos para sync masivo de perfiles.
 */

const APIFY_TOKEN = process.env.APIFY_API_TOKEN
const POST_ACTOR = 'apify/instagram-post-scraper'
const REEL_ACTOR = 'apify/instagram-reel-scraper'

export interface DeliverableMetrics {
  views: number | null
  likes: number | null
  comments: number | null
}

export type DeliverableMetricsResult =
  | { data: DeliverableMetrics }
  | { error: string }

function pickActor(url: string): string {
  return /\/reel\//i.test(url) ? REEL_ACTOR : POST_ACTOR
}

// Los actores oficiales no publican un outputSchema fijo (varía por tipo de
// post/reel) — se leen varios nombres de campo posibles por seguridad, mismo
// criterio defensivo que ya usa src/app/api/influencers/sync-instagram/route.ts
// (ej. profilePicUrlHD ?? profilePicUrl). Si Instagram cambia el shape, esto
// devuelve null en vez de romper, nunca inventa un número.
interface RawApifyItem {
  likesCount?: number
  likeCount?: number
  commentsCount?: number
  commentCount?: number
  videoViewCount?: number
  videoPlayCount?: number
  viewCount?: number
  playsCount?: number
  error?: string
}

export async function fetchDeliverablePostMetrics(url: string): Promise<DeliverableMetricsResult> {
  if (!APIFY_TOKEN) return { error: 'APIFY_API_TOKEN no configurado' }
  if (!url) return { error: 'Sin link de publicación' }

  const actor = pickActor(url)

  let res: Response
  try {
    res = await fetch(
      `https://api.apify.com/v2/acts/${encodeURIComponent(actor)}/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=120`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: [url] }),
      }
    )
  } catch (e) {
    return { error: `No se pudo conectar con Apify: ${(e as Error).message}` }
  }

  if (!res.ok) {
    const txt = await res.text()
    return { error: `Apify error ${res.status}: ${txt.slice(0, 300)}` }
  }

  let items: RawApifyItem[]
  try {
    const json = await res.json()
    items = Array.isArray(json) ? json : (json?.items ?? json?.data ?? [])
  } catch (e) {
    return { error: `Respuesta de Apify inválida: ${(e as Error).message}` }
  }

  if (!items.length) {
    return { error: 'Apify no devolvió datos para este link (puede ser privado, borrado, o el link no es válido)' }
  }

  const item = items[0]
  if (item.error) {
    return { error: `Apify: ${item.error}` }
  }

  return {
    data: {
      views:    item.videoViewCount ?? item.videoPlayCount ?? item.viewCount ?? item.playsCount ?? null,
      likes:    item.likesCount ?? item.likeCount ?? null,
      comments: item.commentsCount ?? item.commentCount ?? null,
    },
  }
}

/**
 * Engagement calculado por nosotros — SIEMPRE etiquetar como "calculado" en
 * la UI, nunca como dato real de Instagram (Instagram no expone engagement
 * rate por post públicamente).
 * Fórmula: (likes + comments) / base * 100, donde base = views si existen
 * (mejor proxy para reels/video), si no, seguidores del influencer.
 */
export function computeEngagementRate(
  metrics: DeliverableMetrics,
  followersFallback: number | null
): number | null {
  const interactions = (metrics.likes ?? 0) + (metrics.comments ?? 0)
  const base = metrics.views && metrics.views > 0 ? metrics.views : followersFallback
  if (!base || base <= 0) return null
  return Math.round((interactions / base) * 10000) / 100
}
