/**
 * Helper compartido para iniciar un run de Apify (scraper de perfil de
 * Instagram). Extraído de src/app/api/influencers/sync-instagram/route.ts
 * para poder reusarlo desde el flujo de creación manual de marca
 * (POST /api/brand/influencers) sin duplicar el fetch a Apify ni exponer
 * el endpoint admin de sync (que acepta influencer_ids arbitrarios) a
 * usuarios de marca.
 */
const APIFY_TOKEN = process.env.APIFY_API_TOKEN
const ACTOR_ID = 'apify/instagram-profile-scraper'

export async function startApifyInstagramSync(
  handles: string[]
): Promise<{ runId: string } | { error: string }> {
  if (!APIFY_TOKEN) return { error: 'APIFY_API_TOKEN no configurado' }
  if (!handles.length) return { error: 'Sin handles para sincronizar' }

  const res = await fetch(
    `https://api.apify.com/v2/acts/${encodeURIComponent(ACTOR_ID)}/runs?token=${APIFY_TOKEN}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernames: handles }),
    }
  )

  if (!res.ok) {
    const txt = await res.text()
    return { error: `Apify error ${res.status}: ${txt.slice(0, 200)}` }
  }

  const { data } = await res.json()
  const runId: string | undefined = data?.id
  if (!runId) return { error: 'Apify no devolvió runId' }
  return { runId }
}
