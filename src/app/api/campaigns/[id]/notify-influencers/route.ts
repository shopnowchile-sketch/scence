import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { announceCampaignReopened, announceCampaignToInfluencers, resolvePendingCampaignAnnouncement, resolveReopenedCampaignAnnouncement, sendCampaignAnnouncementPreview, sendCampaignReopenedPreview } from '@/lib/campaign-notifications'
import { isPlatformAdmin } from '@/lib/supabase/ensureOrg'

type Params = { params: { id: string } }

// El envío recorre todo el roster en lotes de 100 (resend.batch.send). Con el
// default de Vercel se cortaba a mitad de camino y dejaba influencers sin aviso.
export const maxDuration = 300

// GET /api/campaigns/[id]/notify-influencers
// Cuántas influencers quedan por avisar. El detalle de campaña lo usa para
// mostrar el pendiente sin que la fundadora tenga que adivinar ni escribirle a
// nadie (principio 3: el producto hace visible qué falta hacer).
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  if (!(await isPlatformAdmin(user.id, admin))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { campaign, pending, skipped } = await resolvePendingCampaignAnnouncement(params.id, admin)
  if (!campaign) return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })
  // Segundo aviso "ahora abierta para todas" (solo si la campaña pasó de Pro a Pública).
  const reopened = await resolveReopenedCampaignAnnouncement(params.id, admin)

  return NextResponse.json({
    pending: pending.length,
    requires_pro: campaign.visibility === 'private',
    reopen_pending: reopened.skipped ? 0 : reopened.pending.length,
    skipped: skipped ?? null,
  })
}

// POST /api/campaigns/[id]/notify-influencers
// Envío manual del aviso "nueva campaña disponible". Manda a TODAS las que aún
// no fueron avisadas (antes iba de a 50 por click: con 2.000+ influencers eran
// decenas de clicks). La idempotencia la sigue dando
// campaign_influencer_notifications, así que repetir el botón no duplica correos.
export async function POST(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  if (!(await isPlatformAdmin(user.id, admin))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // ?test=1 → una sola copia al correo de quien aprieta el botón. No marca a
  // nadie como notificada ni le escribe a ninguna influencer: sirve para
  // revisar asunto, copy y links ANTES del envío real, que es irreversible.
  const reopenedMode = _req.nextUrl.searchParams.get('mode') === 'reopened'
  if (_req.nextUrl.searchParams.get('test') === '1') {
    if (!user.email) return NextResponse.json({ error: 'Tu cuenta no tiene email para enviar la prueba' }, { status: 422 })
    const preview = reopenedMode
      ? await sendCampaignReopenedPreview(params.id, user.email, admin)
      : await sendCampaignAnnouncementPreview(params.id, user.email, admin)
    if (!preview.ok) return NextResponse.json({ error: preview.error ?? 'No se pudo enviar la prueba' }, { status: 500 })
    return NextResponse.json({ test: true, sent: 1, failed: 0, remaining: 0, to: user.email })
  }

  if (reopenedMode) {
    const reopened = await announceCampaignReopened(params.id, admin)
    if (reopened.skipped === 'not_found') return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })
    if (reopened.skipped === 'not_reopened') return NextResponse.json({ error: 'La campaña debe estar activa y haber pasado a Pública' }, { status: 422 })
    if (reopened.skipped) return NextResponse.json({ error: 'No se pudo completar el envío' }, { status: 500 })
    return NextResponse.json({ ...reopened, message: reopened.sent === 0 ? 'No quedan influencers por avisar' : undefined })
  }

  const result = await announceCampaignToInfluencers(params.id, admin)

  if (result.skipped === 'not_found') return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })
  if (result.skipped === 'not_active') {
    return NextResponse.json({ error: 'La campaña debe estar activa para avisar a las influencers' }, { status: 422 })
  }
  if (result.skipped === 'not_announceable') {
    return NextResponse.json({ error: 'Esta campaña no es anunciable' }, { status: 422 })
  }
  if (result.skipped) return NextResponse.json({ error: 'No se pudo completar el envío' }, { status: 500 })

  return NextResponse.json({
    ...result,
    message: result.sent === 0 ? 'No quedan influencers por avisar' : undefined,
  })
}
