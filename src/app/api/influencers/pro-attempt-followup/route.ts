import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { getOrgId, getUserRole } from '@/lib/supabase/ensureOrg'
import { getResend, FROM_EMAIL } from '@/lib/resend'
import { getInfluencerProStatuses } from '@/lib/influencer-pro'
import { escapeHtml } from '@/lib/utils'

export async function POST(request: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  const { isAdmin } = orgId ? await getUserRole(user.id, orgId, admin) : { isAdmin: false }
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: { influencer_ids?: string[]; subject?: string; message?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 }) }

  const ids = Array.from(new Set((body.influencer_ids ?? []).filter(Boolean)))
  const subject = String(body.subject ?? '').trim()
  const message = String(body.message ?? '').trim()
  if (!ids.length) return NextResponse.json({ error: 'Selecciona al menos una influencer.' }, { status: 422 })
  if (!subject || subject.length > 160) return NextResponse.json({ error: 'Ingresa un asunto válido.' }, { status: 422 })
  if (!message || message.length > 5000) return NextResponse.json({ error: 'Ingresa un mensaje válido.' }, { status: 422 })

  const { data: influencers, error: influencersError } = await admin
    .from('influencers')
    .select('id, display_name, email, organization_id, is_active')
    .in('id', ids)

  if (influencersError) return NextResponse.json({ error: 'No se pudieron cargar las influencers.' }, { status: 500 })

  const orgInfluencers = (influencers ?? []).filter(item => item.organization_id === orgId && item.is_active !== false && item.email)
  if (!orgInfluencers.length) return NextResponse.json({ error: 'Ninguna seleccionada tiene un email válido.' }, { status: 422 })

  const { data: incompleteRows } = await admin
    .from('subscriptions')
    .select('metadata')
    .eq('organization_id', orgId)
    .eq('status', 'incomplete')
  const attemptedIds = new Set((incompleteRows ?? []).map(row => {
    const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata as Record<string, unknown> : {}
    return typeof metadata.influencer_id === 'string' ? metadata.influencer_id : null
  }).filter((id): id is string => Boolean(id)))

  const proStatuses = await getInfluencerProStatuses(admin, orgInfluencers.map(item => item.id))
  const valid = orgInfluencers.filter(item => attemptedIds.has(item.id) && (proStatuses.get(item.id) ?? 'free') === 'free')
  if (!valid.length) return NextResponse.json({ error: 'Ninguna seleccionada tiene un intento Pro pendiente.' }, { status: 422 })

  const resend = getResend()
  const results = await Promise.allSettled(valid.map(influencer =>
    resend.emails.send({
      from: FROM_EMAIL,
      to: influencer.email!,
      subject,
      html: `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;padding:32px"><div style="max-width:560px;margin:auto;background:#fff;border-radius:16px;padding:32px"><div style="font-size:22px;font-weight:900;color:#111827;margin-bottom:24px">SCENCE</div><p style="font-size:15px;color:#374151;line-height:1.7">Hola ${escapeHtml(influencer.display_name)},</p><div style="font-size:15px;color:#374151;line-height:1.7;white-space:pre-wrap">${escapeHtml(message)}</div><p style="margin-top:28px;font-size:13px;color:#9ca3af">SCENCE</p></div></body></html>`,
    })
  ))

  const sent = results.filter(result => result.status === 'fulfilled').length
  const failed = results.length - sent
  return NextResponse.json({ ok: true, sent, failed, total: valid.length })
}
