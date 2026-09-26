/**
 * Sincronización de followers de Instagram vía Meta Business Discovery.
 * Toda escritura pasa por syncInstagramFollowers() (lib/instagram/followers-sync).
 *
 * GET  (Vercel Cron, Bearer CRON_SECRET): procesa un lote de la cola.
 * POST (admin):
 *   { influencer_ids: [...] }  → sincroniza esas influencers (síncrono).
 *   { campaign_id }            → postulantes pendientes de esa campaña.
 *   {}                         → un lote de la cola (igual que el cron).
 *
 * Respuesta: { synced, failed, not_found, remaining, stopped, errors, results }.
 * Ya no existe runId/polling: Apify quedó fuera de este flujo.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { getOrgId, getUserRole } from '@/lib/supabase/ensureOrg'
import {
  createSupabaseSyncStore,
  instagramProfileIdsFor,
  syncInstagramFollowers,
  DEFAULT_BATCH_LIMIT,
} from '@/lib/instagram/followers-sync'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

// Margen bajo maxDuration para devolver el reporte antes de que Vercel corte.
const BATCH_DEADLINE_MS = 240_000
const TARGETED_DEADLINE_MS = 240_000

async function authorize(req: NextRequest): Promise<{ ok: boolean; cron: boolean; status?: number }> {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') === `Bearer ${secret}`) return { ok: true, cron: true }

  const supabase = createServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { ok: false, cron: false, status: 401 }
  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return { ok: false, cron: false, status: 403 }
  const { isAdmin } = await getUserRole(user.id, orgId, admin)
  return { ok: isAdmin, cron: false, status: isAdmin ? undefined : 403 }
}

function configError() {
  return NextResponse.json(
    { error: 'La sincronización con Instagram no está configurada (META_IG_SYSTEM_TOKEN).', synced: 0, failed: 0 },
    { status: 503 },
  )
}

async function runBatch() {
  const admin = createAdminClient()
  return syncInstagramFollowers(createSupabaseSyncStore(admin), {
    limit: Number(process.env.IG_SYNC_BATCH_LIMIT ?? DEFAULT_BATCH_LIMIT),
    deadlineMs: BATCH_DEADLINE_MS,
  })
}

export async function GET(req: NextRequest) {
  const auth = await authorize(req)
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: auth.status })
  if (!process.env.META_IG_SYSTEM_TOKEN) return configError()
  try {
    return NextResponse.json(await runBatch())
  } catch (error) {
    console.error('[instagram-followers] batch-error', (error as Error).message)
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await authorize(req)
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: auth.status })
  if (!process.env.META_IG_SYSTEM_TOKEN) return configError()

  let body: { influencer_ids?: string[]; campaign_id?: string } = {}
  try { body = await req.json() } catch { /* body vacío = un lote de la cola */ }
  const admin = createAdminClient()

  try {
    let influencerIds = Array.isArray(body.influencer_ids) ? body.influencer_ids.filter(Boolean) : []

    // Sync dirigido por campaña: solo postulantes pendientes reales (admin-only).
    if (body.campaign_id && !influencerIds.length) {
      const { data: rows, error } = await admin
        .from('campaign_influencers')
        .select('influencer_id')
        .eq('campaign_id', body.campaign_id)
        .eq('application_status', 'pending')
        .eq('origin', 'application')
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      influencerIds = Array.from(new Set((rows ?? []).map(row => row.influencer_id).filter((id): id is string => Boolean(id))))
      if (!influencerIds.length) {
        return NextResponse.json({ synced: 0, failed: 0, not_found: 0, remaining: 0, errors: [], message: 'No hay postulantes pendientes en esta campaña.' })
      }
    }

    if (!influencerIds.length) return NextResponse.json(await runBatch())

    const profileIds = await instagramProfileIdsFor(admin, influencerIds)
    if (!profileIds.length) {
      return NextResponse.json({ synced: 0, failed: 0, not_found: 0, remaining: 0, errors: [], message: 'Estas influencers no tienen Instagram registrado.' })
    }
    const report = await syncInstagramFollowers(createSupabaseSyncStore(admin), {
      profileIds,
      limit: profileIds.length,
      deadlineMs: TARGETED_DEADLINE_MS,
    })
    return NextResponse.json(report)
  } catch (error) {
    console.error('[instagram-followers] request-error', (error as Error).message)
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}
