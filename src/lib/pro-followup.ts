// Seguimiento Pro manual (2026-11-09). Un admin elige influencers, ve el correo exacto,
// confirma y envía. NADA se envía solo. Dos tipos con reglas distintas:
//   assistance → ayuda por problema de pago/activación: ignora bajas y preferencias de campañas.
//   commercial → recordatorio comercial: respeta bajas (email_optouts) y lleva link de baja.
// Cualquier influencer con cobro sin verificar (payer de PayPal en un intento) → SOLO asistencia.
import type { SupabaseClient } from '@supabase/supabase-js'
import { getInfluencerProStatuses } from '@/lib/influencer-pro'
import { getBlockedEmails, recordOptOut, buildInfluencerUnsubscribeUrl, commercialEmailHeaders, normalizeEmail } from '@/lib/email-optouts'
import { escapeHtml } from '@/lib/utils'

type Admin = SupabaseClient<any, any, any>
export type FollowupKind = 'assistance' | 'commercial'

export const REPEAT_WINDOW_DAYS = 7
export const SUBJECT_MAX = 160
export const BODY_MAX = 5000

export type Candidate = {
  id: string
  display_name: string
  email: string | null
  organization_id: string | null
  is_active: boolean | null
  pro: 'paid' | 'manual' | 'free'
  attempts: number
  lastAttemptAt: string | null
  unverifiedCharge: boolean
  optedOut: boolean
  lastSent: { template_key: string; created_at: string } | null
  sentRecently: boolean
}

export type Verdict = { eligible: boolean; reason: string | null }

/** Reglas puras: una sola fuente para pantalla y envío. */
export function evaluateCandidate(c: Candidate, kind: FollowupKind, orgId: string): Verdict {
  if (c.organization_id !== orgId) return { eligible: false, reason: 'No pertenece a esta organización' }
  if (c.is_active === false) return { eligible: false, reason: 'Influencer inactiva' }
  if (!c.email) return { eligible: false, reason: 'Sin correo' }
  if (c.pro !== 'free') return { eligible: false, reason: 'Ya tiene Pro activo' }
  if (kind === 'assistance') {
    if (c.attempts === 0) return { eligible: false, reason: 'No tiene intento Pro pendiente' }
  } else {
    if (c.unverifiedCharge) return { eligible: false, reason: 'Cobro sin verificar: solo asistencia' }
    if (c.optedOut) return { eligible: false, reason: 'Se dio de baja de correos comerciales' }
  }
  if (c.sentRecently) return { eligible: false, reason: `Ya se le envió esta plantilla en los últimos ${REPEAT_WINDOW_DAYS} días` }
  return { eligible: true, reason: null }
}

export function appPlanUrl(appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app') {
  return `${appUrl}/inf-profile?tab=plan`
}

export function renderText(text: string, vars: { nombre: string; plan_url: string }) {
  return text.replace(/\{\{\s*nombre\s*\}\}/g, vars.nombre).replace(/\{\{\s*plan_url\s*\}\}/g, vars.plan_url)
}

export function extractLinks(text: string): string[] {
  return Array.from(new Set(text.match(/https?:\/\/[^\s<>"')]+/g) ?? []))
}

export function buildHtml(name: string, body: string, unsubscribeUrl: string | null) {
  const foot = unsubscribeUrl
    ? `<p style="margin-top:28px;font-size:12px;color:#9ca3af">Si no quieres recibir más correos comerciales de SCENCE, <a href="${escapeHtml(unsubscribeUrl)}" style="color:#9ca3af">date de baja aquí</a>. Los correos de tu cuenta seguirán llegando.</p>`
    : ''
  return `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;padding:32px"><div style="max-width:560px;margin:auto;background:#fff;border-radius:16px;padding:32px"><div style="font-size:22px;font-weight:900;color:#111827;margin-bottom:24px">SCENCE</div><p style="font-size:15px;color:#374151;line-height:1.7">Hola ${escapeHtml(name)},</p><div style="font-size:15px;color:#374151;line-height:1.7;white-space:pre-wrap">${escapeHtml(body)}</div><p style="margin-top:28px;font-size:13px;color:#9ca3af">SCENCE</p>${foot}</div></body></html>`
}

function attemptMeta(row: { metadata?: unknown; paypal_payer_id?: string | null; created_at?: string | null }) {
  const m = row.metadata && typeof row.metadata === 'object' ? row.metadata as Record<string, unknown> : {}
  return { influencerId: typeof m.influencer_id === 'string' ? m.influencer_id : null }
}

/** Carga datos reales y arma los candidatos. Falla cerrado si algo no se puede verificar. */
export async function loadCandidates(admin: Admin, orgId: string, ids: string[], templateKey: string, kind: FollowupKind, now = new Date()): Promise<Candidate[]> {
  const unique = Array.from(new Set(ids.filter(Boolean)))
  if (!unique.length) return []

  const { data: infs, error } = await admin.from('influencers').select('id, display_name, email, organization_id, is_active').in('id', unique)
  if (error) throw new Error('No se pudieron cargar las influencers.')

  const { data: subs, error: subsError } = await admin
    .from('subscriptions').select('metadata, paypal_payer_id, created_at').eq('organization_id', orgId).eq('status', 'incomplete')
  if (subsError) throw new Error('No se pudieron cargar los intentos Pro.')
  const attempts = new Map<string, { n: number; last: string | null; payer: boolean }>()
  for (const row of subs ?? []) {
    const { influencerId } = attemptMeta(row)
    if (!influencerId) continue
    const cur = attempts.get(influencerId) ?? { n: 0, last: null, payer: false }
    cur.n += 1
    if (row.created_at && (!cur.last || row.created_at > cur.last)) cur.last = row.created_at
    if (row.paypal_payer_id) cur.payer = true
    attempts.set(influencerId, cur)
  }

  const pro = await getInfluencerProStatuses(admin, unique)

  const emails = (infs ?? []).map(i => i.email)
  const blocked = kind === 'commercial' ? await getBlockedEmails(admin, emails) : new Set<string>()

  const since = new Date(now.getTime() - REPEAT_WINDOW_DAYS * 86400000).toISOString()
  const { data: logs, error: logError } = await admin
    .from('influencer_email_log').select('influencer_id, template_key, created_at, status')
    .in('influencer_id', unique).eq('status', 'sent').order('created_at', { ascending: false })
  if (logError) throw new Error('No se pudo leer el historial de envíos.')

  return (infs ?? []).map(i => {
    const a = attempts.get(i.id)
    const mine = (logs ?? []).filter(l => l.influencer_id === i.id)
    return {
      id: i.id, display_name: i.display_name, email: i.email, organization_id: i.organization_id, is_active: i.is_active,
      pro: (pro.get(i.id) ?? 'free') as Candidate['pro'],
      attempts: a?.n ?? 0, lastAttemptAt: a?.last ?? null, unverifiedCharge: a?.payer ?? false,
      optedOut: blocked.has(normalizeEmail(i.email)),
      lastSent: mine[0] ? { template_key: mine[0].template_key, created_at: mine[0].created_at } : null,
      sentRecently: mine.some(l => l.template_key === templateKey && l.created_at >= since),
    }
  })
}

export type PreviewItem = {
  influencer_id: string; name: string; to: string | null; from: string; subject: string; body: string
  links: string[]; unsubscribe_url: string | null; eligible: boolean; reason: string | null
  pro: string; attempts: number; last_attempt_at: string | null; unverified_charge: boolean
  last_sent: Candidate['lastSent']
}

export function buildPreview(cands: Candidate[], kind: FollowupKind, orgId: string, subject: string, body: string, from: string): PreviewItem[] {
  const plan = appPlanUrl()
  return cands.map(c => {
    const v = evaluateCandidate(c, kind, orgId)
    const vars = { nombre: c.display_name, plan_url: plan }
    const unsub = kind === 'commercial' ? buildInfluencerUnsubscribeUrl(c.id) : null
    const renderedBody = renderText(body, vars)
    return {
      influencer_id: c.id, name: c.display_name, to: c.email, from,
      subject: renderText(subject, vars), body: renderedBody,
      links: [...extractLinks(renderedBody), ...(unsub ? [unsub] : [])],
      unsubscribe_url: unsub, eligible: v.eligible, reason: v.reason,
      pro: c.pro, attempts: c.attempts, last_attempt_at: c.lastAttemptAt, unverified_charge: c.unverifiedCharge, last_sent: c.lastSent,
    }
  })
}

export type SendResult = { influencer_id: string; name: string; to: string | null; status: 'sent' | 'failed' | 'skipped'; resend_id?: string | null; error?: string | null }

type Sender = { emails: { send: (p: any) => Promise<{ data?: { id?: string } | null; error?: { message?: string } | null }> } }

/** Envía uno a uno, registrando cada resultado. Resend no lanza: se revisa `error`. */
export async function sendFollowup(
  admin: Admin, resend: Sender, from: string,
  input: { orgId: string; userId: string; ids: string[]; kind: FollowupKind; templateKey: string; subject: string; body: string; now?: Date },
): Promise<SendResult[]> {
  const now = input.now ?? new Date()
  const cands = await loadCandidates(admin, input.orgId, input.ids, input.templateKey, input.kind, now)
  const items = buildPreview(cands, input.kind, input.orgId, input.subject, input.body, from)
  const day = now.toISOString().slice(0, 10)
  const results: SendResult[] = []

  for (const item of items) {
    if (!item.eligible || !item.to) {
      results.push({ influencer_id: item.influencer_id, name: item.name, to: item.to, status: 'skipped', error: item.reason })
      continue
    }
    const dedupe = `${item.influencer_id}:${input.templateKey}:${day}`
    let resendId: string | null = null
    let err: string | null = null
    try {
      const payload: Record<string, unknown> = {
        from, to: item.to, subject: item.subject,
        html: buildHtml(item.name, item.body, item.unsubscribe_url),
      }
      if (item.unsubscribe_url) payload.headers = commercialEmailHeaders(item.unsubscribe_url)
      const r = await resend.emails.send(payload)
      if (r.error) err = r.error.message ?? 'Error de Resend'
      else resendId = r.data?.id ?? null
    } catch (e) { err = e instanceof Error ? e.message : 'Error al enviar' }

    const status = err ? 'failed' : 'sent'
    const { error: logErr } = await admin.from('influencer_email_log').insert({
      influencer_id: item.influencer_id, template_key: input.templateKey, kind: input.kind, to_email: item.to,
      subject: item.subject, body: item.body, status, resend_id: resendId, error: err,
      dedupe_key: status === 'sent' ? dedupe : null, sent_by: input.userId,
    })
    if (logErr) console.error('[pro-followup] no se pudo registrar el envío', logErr)
    results.push({ influencer_id: item.influencer_id, name: item.name, to: item.to, status, resend_id: resendId, error: err ?? (logErr ? 'Enviado, pero no se pudo registrar en el historial' : null) })
  }
  return results
}

/** Baja comercial manual (la influencer lo pidió por otro canal). No afecta asistencia ni correos de cuenta. */
export async function registerManualOptOut(admin: Admin, orgId: string, ids: string[]): Promise<number> {
  const { data: infs } = await admin.from('influencers').select('id, email').in('id', ids).eq('organization_id', orgId)
  let done = 0
  for (const i of infs ?? []) {
    const r = await recordOptOut(admin, { email: i.email, reason: 'manual', source: 'admin_followup' })
    if (r.ok) done++
  }
  return done
}
