import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getResend, FROM_EMAIL, campaignOpenAvailableEmail } from '@/lib/resend'
import { getPrimarySocial, type RankingInfluencerRow } from '@/lib/influencers/ranking'

type Params = { params: { id: string } }

const ADMIN_ROLES = ['super_admin']
const BATCH_SIZE = 50
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'

async function isAdmin(userId: string, admin: ReturnType<typeof createAdminClient>) {
  const { data } = await admin.from('profiles').select('role').eq('id', userId).maybeSingle()
  return ADMIN_ROLES.includes(String(data?.role ?? ''))
}

// POST /api/campaigns/[id]/notify-influencers
// Botón manual (admin) — envía email de "campaña abierta disponible" a las
// siguientes 50 influencers elegibles con más seguidores que aún no fueron
// notificadas para esta campaña. Cada click avanza al siguiente batch (no
// repite), vía campaign_influencer_notifications.
export async function POST(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  if (!(await isAdmin(user.id, admin))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: campaign, error: campErr } = await admin
    .from('campaigns')
    .select('id, name, type, visibility, organization_id')
    .eq('id', params.id)
    .maybeSingle()

  if (campErr) return NextResponse.json({ error: campErr.message }, { status: 500 })
  if (!campaign) return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })
  if (campaign.visibility !== 'open') {
    return NextResponse.json({ error: 'Solo campañas públicas (visibility=open) pueden notificarse' }, { status: 422 })
  }

  // Ya asignadas/postuladas a esta campaña — no notificar de nuevo
  const { data: existingRows } = await admin
    .from('campaign_influencers')
    .select('influencer_id')
    .eq('campaign_id', params.id)

  // Ya notificadas antes para esta campaña — el botón avanza al siguiente batch
  const { data: notifiedRows } = await admin
    .from('campaign_influencer_notifications')
    .select('influencer_id')
    .eq('campaign_id', params.id)

  const excludeIds = new Set([
    ...(existingRows ?? []).map(r => r.influencer_id).filter(Boolean),
    ...(notifiedRows ?? []).map(r => r.influencer_id).filter(Boolean),
  ])

  let infQuery = admin
    .from('influencers')
    .select(`
      id, display_name, email,
      social_profiles:influencer_social_profiles ( platform, username, followers, is_primary )
    `)
    .eq('is_active', true)
    .not('email', 'is', null)

  if (campaign.organization_id) infQuery = infQuery.eq('organization_id', campaign.organization_id)

  const { data: candidates, error: infErr } = await infQuery

  if (infErr) return NextResponse.json({ error: infErr.message }, { status: 500 })

  const eligible = (candidates ?? [])
    .filter(inf => !excludeIds.has(inf.id))
    .map(inf => ({
      ...inf,
      followers: Number(getPrimarySocial(inf as unknown as RankingInfluencerRow)?.followers ?? 0),
    }))
    .sort((a, b) => b.followers - a.followers)

  const batch = eligible.slice(0, BATCH_SIZE)

  if (batch.length === 0) {
    return NextResponse.json({ sent: 0, failed: 0, remaining: 0, message: 'No quedan influencers elegibles por notificar' })
  }

  let sent = 0
  let failed = 0

  for (const inf of batch) {
    try {
      await getResend().emails.send({
        from: FROM_EMAIL,
        to: inf.email as string,
        subject: `Nueva campaña abierta: ${campaign.name}`,
        html: campaignOpenAvailableEmail({
          influencerName: inf.display_name ?? 'influencer',
          campaignName: campaign.name,
          campaignType: campaign.type,
          applyUrl: `${APP_URL}/inf-campaign/${campaign.id}`,
        }),
      })

      await admin
        .from('campaign_influencer_notifications')
        .upsert({ campaign_id: campaign.id, influencer_id: inf.id }, { onConflict: 'campaign_id,influencer_id' })

      sent += 1
    } catch (e) {
      console.error('[notify-influencers] error enviando a', inf.id, e)
      failed += 1
    }
  }

  return NextResponse.json({
    sent,
    failed,
    remaining: Math.max(0, eligible.length - batch.length),
  })
}
