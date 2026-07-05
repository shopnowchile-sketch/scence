import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getResend, FROM_EMAIL, deliverableReminderEmail } from '@/lib/resend'

type Params = { params: { id: string } }

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'

// POST /api/campaigns/[id]/deliverables/remind
// Envía un email de recordatorio a UNA influencer con sus entregables
// pendientes de ESTA campaña. No cambia ningún status ni rating — solo
// notifica. Reutiliza getResend()/FROM_EMAIL igual que el resto de emails
// del proyecto (ver src/lib/campaign-applications.ts).
export async function POST(req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { influencer_id?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { influencer_id } = body
  if (!influencer_id) return NextResponse.json({ error: 'influencer_id requerido' }, { status: 422 })

  const admin = createAdminClient()

  const { data: campaign } = await admin
    .from('campaigns')
    .select('id, name')
    .eq('id', params.id)
    .single()
  if (!campaign) return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })

  const { data: influencer } = await admin
    .from('influencers')
    .select('id, display_name, email')
    .eq('id', influencer_id)
    .single()
  if (!influencer) return NextResponse.json({ error: 'Influencer no encontrada' }, { status: 404 })

  // Pendientes = sin URL subida y sin status aprobado/completado/publicado
  // (mismo criterio de "completado" que el resumen visual de la campaña).
  const { data: deliverables, error } = await admin
    .from('campaign_deliverables')
    .select('id, title, type, status, content_url, published_url')
    .eq('campaign_id', params.id)
    .eq('influencer_id', influencer_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const pending = (deliverables ?? []).filter(d =>
    !d.content_url && !d.published_url && !['approved', 'completed', 'published'].includes(d.status)
  )

  if (pending.length === 0) {
    return NextResponse.json({ error: 'Esta influencer no tiene entregables pendientes en esta campaña' }, { status: 422 })
  }

  if (!influencer.email) {
    return NextResponse.json({ error: 'Esta influencer no tiene email registrado' }, { status: 422 })
  }

  const { error: emailErr } = await getResend().emails.send({
    from:    FROM_EMAIL,
    to:      influencer.email,
    subject: `Recordatorio: entregables pendientes en "${campaign.name}"`,
    html: deliverableReminderEmail({
      influencerName: influencer.display_name,
      campaignName:   campaign.name,
      pendingTitles:  pending.map(d => d.title || d.type || 'Entregable'),
      appUrl:         `${APP_URL}/inf-tasks?campaign=${params.id}`,
    }),
  })

  if (emailErr) {
    console.error('[POST /api/campaigns/[id]/deliverables/remind] Resend error:', emailErr)
    return NextResponse.json({ error: 'No se pudo enviar el email' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, pending_count: pending.length })
}
