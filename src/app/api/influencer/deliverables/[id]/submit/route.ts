import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { ADMIN_NOTIFICATION_EMAIL, getResend, FROM_EMAIL } from '@/lib/resend'
import { didContentUrlChange, normalizeContentUrl } from '@/lib/deliverables/metrics-state'

type Params = { params: { id: string } }

/**
 * POST /api/influencer/deliverables/[id]/submit
 * Influencer submits content for a deliverable → status changes to 'in_review'
 * Body: { content_url?: string, notes?: string }
 */
export async function POST(req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { content_url?: string; notes?: string } = {}
  try { body = await req.json() } catch { /* empty body ok */ }

  const admin = createAdminClient()

  // Verify the deliverable belongs to this user's influencer profile
  const { data: influencer } = await admin
    .from('influencers')
    .select('id, display_name, organization_id')
    .eq('user_id', user.id)
    .single()

  if (!influencer) return NextResponse.json({ error: 'Influencer not found' }, { status: 404 })

  const { data: deliverable } = await admin
    .from('campaign_deliverables')
    .select('id, status, influencer_id, type, title, due_date, campaign_id, content_url, campaign:campaigns(name, organization_id, status)')
    .eq('id', params.id)
    .single()

  if (!deliverable) return NextResponse.json({ error: 'Deliverable not found' }, { status: 404 })
  if (deliverable.influencer_id !== influencer.id) {
    return NextResponse.json({ error: 'No tienes acceso a este deliverable' }, { status: 403 })
  }
  // Gate por estado de campaña: no se puede entregar contenido a una campaña en
  // borrador/revisión (preasignación aún no activada).
  {
    const campSt = String((deliverable.campaign as unknown as { status?: string } | null)?.status ?? '')
    if (campSt === 'draft' || campSt === 'pending_approval') {
      return NextResponse.json({ error: 'Esta campaña aún no está activa' }, { status: 403 })
    }
  }
  if (deliverable.status === 'approved' || deliverable.status === 'published') {
    return NextResponse.json({ error: 'Este deliverable ya fue aprobado' }, { status: 422 })
  }

  const nextContentUrl = normalizeContentUrl(body.content_url)
  const contentUrlChanged = didContentUrlChange(deliverable.content_url, nextContentUrl)

  const updatePayload: Record<string, unknown> = {
    status:          'in_review',
    content_url:     nextContentUrl,
    submitted_at:    new Date().toISOString(),
    submitted_notes: body.notes ?? null,
  }

  // Las métricas pertenecen al URL consultado, no al deliverable en abstracto.
  // Si el link no cambió se conservan (por ejemplo, al corregir sólo las notas).
  if (contentUrlChanged) {
    updatePayload.performance = null
    updatePayload.metrics_provider = null
    updatePayload.metrics_updated_at = null
    updatePayload.engagement_rate = null
  }

  const { data, error } = await admin
    .from('campaign_deliverables')
    .update(updatePayload)
    .eq('id', params.id)
    .select()
    .single()

  if (error) {
    console.error('[POST /api/influencer/deliverables/[id]/submit]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Non-fatal: notify the central SCENCE operations inbox.
  try {
    if (ADMIN_NOTIFICATION_EMAIL) {
        const influencerName = influencer.display_name ?? 'Influencer'
        const deliverableTitle = (deliverable as { title?: string | null }).title ?? 'Entregable'
        const campaignData = (deliverable as { campaign?: { name?: string } | null }).campaign
        const campaignName = campaignData?.name ?? 'Campaña'
        const contentUrl = nextContentUrl

        const { error: sendErr } = await getResend().emails.send({
          from: FROM_EMAIL,
          to: ADMIN_NOTIFICATION_EMAIL,
          subject: `Nueva entrega de contenido — ${influencerName} · ${deliverableTitle}`,
          html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:32px 0">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
    <div style="background:linear-gradient(135deg,#7c3aed,#4f46e5);padding:32px;text-align:center">
      <div style="font-size:36px;margin-bottom:8px">📥</div>
      <p style="color:rgba(255,255,255,0.9);font-size:14px;font-weight:600;margin:0">Nueva entrega de contenido</p>
    </div>
    <div style="padding:32px">
      <h1 style="font-size:20px;font-weight:700;color:#111827;margin:0 0 16px">Hay una nueva entrega para revisar</h1>
      <div style="background:#f3f4f6;border-radius:12px;padding:20px;margin-bottom:24px">
        <p style="color:#374151;font-size:14px;margin:0 0 8px"><strong>Influencer:</strong> ${influencerName}</p>
        <p style="color:#374151;font-size:14px;margin:0 0 8px"><strong>Entregable:</strong> ${deliverableTitle}</p>
        <p style="color:#374151;font-size:14px;margin:0${contentUrl ? ' 0 8px' : ''}"><strong>Campaña:</strong> ${campaignName}</p>
        ${contentUrl ? `<p style="color:#374151;font-size:14px;margin:0"><strong>Contenido:</strong> <a href="${contentUrl}" style="color:#7c3aed">${contentUrl}</a></p>` : ''}
      </div>
      <p style="color:#6b7280;font-size:13px;margin:0">Entra a Scence para revisar y aprobar o rechazar la entrega.</p>
    </div>
    <div style="background:#f9fafb;padding:16px 32px;text-align:center;border-top:1px solid #f3f4f6">
      <p style="color:#d1d5db;font-size:11px;margin:0">Powered by Scence</p>
    </div>
  </div>
</body>
</html>`,
        })
        // Resend no lanza excepción en errores de API — hay que revisar `error`.
        if (sendErr) console.warn('[deliverable submit] Resend devolvió error:', sendErr)
    }
  } catch (emailErr) {
    console.warn('[deliverable submit] email notification failed (non-fatal):', emailErr)
  }

  return NextResponse.json({ data })
}
