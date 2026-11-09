import { NextRequest, NextResponse } from 'next/server'
import { getResend, FROM_EMAIL } from '@/lib/resend'
import { requireAdmin } from '@/lib/pro-followup-admin'
import { registerManualOptOut, loadCandidates, buildPreview, sendFollowup, SUBJECT_MAX, BODY_MAX, type FollowupKind } from '@/lib/pro-followup'

// Seguimiento Pro MANUAL. Nada se envía sin una petición explícita de un admin con confirm:true.
// POST { action: 'preview' | 'send' | 'optout', influencer_ids, template_key, subject?, body?, confirm? }
// GET  ?influencer_id=...  → historial individual.

export const maxDuration = 120

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error
  const id = new URL(request.url).searchParams.get('influencer_id')
  if (!id) return NextResponse.json({ error: 'Falta influencer_id.' }, { status: 422 })
  const { data: inf } = await auth.admin.from('influencers').select('id').eq('id', id).eq('organization_id', auth.orgId).maybeSingle()
  if (!inf) return NextResponse.json({ error: 'No encontrada.' }, { status: 404 })
  const { data, error } = await auth.admin.from('influencer_email_log')
    .select('id, template_key, kind, to_email, subject, status, resend_id, error, created_at').eq('influencer_id', id).order('created_at', { ascending: false }).limit(50)
  if (error) return NextResponse.json({ error: 'No se pudo cargar el historial.' }, { status: 500 })
  return NextResponse.json({ history: data ?? [] })
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error
  const { admin, orgId, userId } = auth

  let body: { action?: string; influencer_ids?: string[]; template_key?: string; subject?: string; body?: string; confirm?: boolean }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 }) }

  const ids = Array.from(new Set((body.influencer_ids ?? []).filter(Boolean))).slice(0, 100)
  if (!ids.length) return NextResponse.json({ error: 'Selecciona al menos una influencer.' }, { status: 422 })

  // Baja comercial manual (p. ej. pidió no recibir más por WhatsApp o respuesta).
  if (body.action === 'optout') {
    const done = await registerManualOptOut(admin, orgId, ids)
    return NextResponse.json({ ok: true, opted_out: done })
  }

  if (body.action !== 'preview' && body.action !== 'send') return NextResponse.json({ error: 'Acción inválida.' }, { status: 422 })

  const { data: tpl } = await admin.from('influencer_email_templates').select('key, kind, subject, body').eq('key', String(body.template_key ?? '')).maybeSingle()
  if (!tpl) return NextResponse.json({ error: 'Plantilla no encontrada.' }, { status: 404 })
  const kind = tpl.kind as FollowupKind
  const subject = String(body.subject ?? tpl.subject).trim()
  const text = String(body.body ?? tpl.body).trim()
  if (!subject || subject.length > SUBJECT_MAX) return NextResponse.json({ error: 'Asunto inválido.' }, { status: 422 })
  if (!text || text.length > BODY_MAX) return NextResponse.json({ error: 'Mensaje inválido.' }, { status: 422 })

  try {
    if (body.action === 'preview') {
      const cands = await loadCandidates(admin, orgId, ids, tpl.key, kind)
      return NextResponse.json({ kind, from: FROM_EMAIL, items: buildPreview(cands, kind, orgId, subject, text, FROM_EMAIL) })
    }
    if (body.confirm !== true) return NextResponse.json({ error: 'Falta la confirmación explícita.' }, { status: 422 })
    const results = await sendFollowup(admin, getResend() as never, FROM_EMAIL, { orgId, userId, ids, kind, templateKey: tpl.key, subject, body: text })
    const sent = results.filter(r => r.status === 'sent').length
    return NextResponse.json({ ok: true, sent, failed: results.filter(r => r.status === 'failed').length, skipped: results.filter(r => r.status === 'skipped').length, results })
  } catch (e) {
    // Falla cerrado (p. ej. no se pudo verificar la lista de bajas): no se envía nada.
    console.error('[pro-followup]', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'No se pudo completar.' }, { status: 500 })
  }
}
