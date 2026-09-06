import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { announceCampaignToInfluencers, resolvePendingCampaignAnnouncement } from '@/lib/campaign-notifications'
import { getOrgId, getUserRole } from '@/lib/supabase/ensureOrg'

type Params = { params: { id: string } }

// El envío recorre todo el roster en lotes de 100 (resend.batch.send). Con el
// default de Vercel se cortaba a mitad de camino y dejaba influencers sin aviso.
export const maxDuration = 300

async function requireAdmin(userId: string, userMetadata: unknown, admin: ReturnType<typeof createAdminClient>) {
  // Autorización por organization_members (fuente canónica), nunca profiles.role.
  const orgId = await getOrgId(userId, userMetadata as Record<string, unknown>, admin)
  const { isAdmin } = orgId ? await getUserRole(userId, orgId, admin) : { isAdmin: false }
  return isAdmin
}

// GET /api/campaigns/[id]/notify-influencers
// Cuántas influencers quedan por avisar. El detalle de campaña lo usa para
// mostrar el pendiente sin que la fundadora tenga que adivinar ni escribirle a
// nadie (principio 3: el producto hace visible qué falta hacer).
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  if (!(await requireAdmin(user.id, user.user_metadata, admin))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { campaign, pending, skipped } = await resolvePendingCampaignAnnouncement(params.id, admin)
  if (!campaign) return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })

  return NextResponse.json({
    pending: pending.length,
    requires_pro: campaign.visibility === 'private',
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
  if (!(await requireAdmin(user.id, user.user_metadata, admin))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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
