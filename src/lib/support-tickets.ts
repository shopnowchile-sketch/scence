// Soporte: reglas compartidas por las rutas de tickets (orden, plantillas, Seguimiento Pro).
// Un intento Pro pendiente es un ticket normal (categoría 'pro_followup') a nombre de la influencer:
// se gestiona con los mismos estados, conversación y envío. Nada se envía al crearlo.
import type { SupabaseClient } from '@supabase/supabase-js'
import { getInfluencerProStatuses } from '@/lib/influencer-pro'

type Admin = SupabaseClient<any, any, any>

export const TICKET_PRIORITIES = ['P0', 'P1', 'P2', 'P3'] as const
export const TICKET_STATUSES = ['open', 'in_progress', 'closed'] as const
export const ACTIVE_STATUSES = ['open', 'in_progress'] as const
export const PRO_CATEGORY = 'pro_followup'
export const PRO_TICKET_TITLE = 'Ayuda con tu suscripción Pro'
export const PRO_TICKET_DESCRIPTION = 'Detectamos que intentaste activar SCENCE Pro y el proceso no quedó completo. Te escribiremos para ayudarte a terminarlo.'
const PRO_TEXT = /\b(pro|suscripci|paypal|cobr|pago|plan)/i

/** Variables de las plantillas. Se reemplazan al elegirla y, por seguridad, otra vez al enviar. */
export function renderTemplate(text: string, vars: { nombre?: string; plan_url?: string }) {
  return text
    .replace(/\{\{\s*nombre\s*\}\}/g, vars.nombre ?? '')
    .replace(/\{\{\s*plan_url\s*\}\}/g, vars.plan_url ?? '')
}

export function planUrl(base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app') {
  return `${base}/inf-profile?tab=plan`
}

export function mentionsPro(title: string | null | undefined, description: string | null | undefined) {
  return PRO_TEXT.test(`${title ?? ''} ${description ?? ''}`)
}

type Attempt = { influencerId: string; userId: string | null; organizationId: string | null; name: string | null }

/** Influencers sin Pro con un intento incompleto en la organización. Solo lectura. */
export async function loadProAttempts(admin: Admin, orgId: string): Promise<{ attempts: Attempt[]; error: string | null }> {
  const { data: subs, error } = await admin.from('subscriptions').select('metadata').eq('organization_id', orgId).eq('status', 'incomplete')
  if (error) return { attempts: [], error: 'No se pudieron leer los intentos Pro.' }
  const ids = Array.from(new Set((subs ?? []).map(r => {
    const m = r.metadata && typeof r.metadata === 'object' ? r.metadata as Record<string, unknown> : {}
    return typeof m.influencer_id === 'string' ? m.influencer_id : null
  }).filter((x): x is string => Boolean(x))))
  if (!ids.length) return { attempts: [], error: null }

  const { data: infs, error: infError } = await admin.from('influencers').select('id, user_id, organization_id, display_name, is_active').in('id', ids)
  if (infError) return { attempts: [], error: 'No se pudieron leer las influencers.' }
  let statuses: Map<string, string>
  try { statuses = await getInfluencerProStatuses(admin, ids) } catch { return { attempts: [], error: 'No se pudo verificar el estado Pro.' } }

  return {
    error: null,
    attempts: (infs ?? [])
      .filter(i => i.organization_id === orgId && i.is_active !== false && (statuses.get(i.id) ?? 'free') === 'free')
      .map(i => ({ influencerId: i.id, userId: i.user_id ?? null, organizationId: i.organization_id, name: i.display_name ?? null })),
  }
}

/**
 * Tickets que muestra el filtro «Seguimiento Pro»: los creados por «Actualizar Pro» y los tickets
 * activos que ya había sobre Pro de influencers con intento pendiente (no se modifican).
 */
export async function proFollowupTicketIds(admin: Admin, orgId: string): Promise<{ ids: string[]; error: string | null }> {
  const { data: own, error } = await admin.from('tickets').select('id').eq('organization_id', orgId).eq('category', PRO_CATEGORY).in('status', [...ACTIVE_STATUSES])
  if (error) return { ids: [], error: 'No se pudieron leer los tickets Pro.' }
  const { attempts, error: attemptsError } = await loadProAttempts(admin, orgId)
  if (attemptsError) return { ids: [], error: attemptsError }
  const users = attempts.map(a => a.userId).filter((x): x is string => Boolean(x))
  const ids = new Set((own ?? []).map(t => t.id as string))
  if (users.length) {
    const { data: related, error: relatedError } = await admin.from('tickets').select('id, title, description').eq('organization_id', orgId).in('created_by', users).in('status', [...ACTIVE_STATUSES])
    if (relatedError) return { ids: [], error: 'No se pudieron leer los tickets relacionados.' }
    for (const t of related ?? []) if (mentionsPro(t.title, t.description)) ids.add(t.id as string)
  }
  return { ids: Array.from(ids), error: null }
}

export type SyncResult = { created: number; existing: number; without_account: number; total: number; error?: string }

/** «Actualizar Pro»: un ticket por intento sin ticket Pro activo. Sin correos. dryRun solo cuenta. */
export async function syncProTickets(admin: Admin, orgId: string, opts: { dryRun?: boolean } = {}): Promise<SyncResult> {
  const { attempts, error } = await loadProAttempts(admin, orgId)
  if (error) return { created: 0, existing: 0, without_account: 0, total: 0, error }
  const withAccount = attempts.filter(a => a.userId)
  const without_account = attempts.length - withAccount.length

  const covered = new Set<string>()
  if (withAccount.length) {
    const { data, error: tError } = await admin.from('tickets').select('created_by, category, title, description')
      .eq('organization_id', orgId).in('created_by', withAccount.map(a => a.userId!)).in('status', [...ACTIVE_STATUSES])
    if (tError) return { created: 0, existing: 0, without_account, total: attempts.length, error: 'No se pudieron leer los tickets.' }
    for (const t of data ?? []) if (t.category === PRO_CATEGORY || mentionsPro(t.title, t.description)) covered.add(t.created_by as string)
  }

  const missing = withAccount.filter(a => !covered.has(a.userId!))
  if (opts.dryRun) return { created: missing.length, existing: withAccount.length - missing.length, without_account, total: attempts.length }

  let created = 0
  let existing = withAccount.length - missing.length
  for (const a of missing) {
    const { error: insertError } = await admin.from('tickets').insert({
      title: PRO_TICKET_TITLE, description: PRO_TICKET_DESCRIPTION, status: 'open', priority: 'P2',
      category: PRO_CATEGORY, created_by: a.userId, organization_id: a.organizationId ?? orgId, ai_review: null,
    })
    if (!insertError) created++
    else if (insertError.code === '23505') existing++ // el índice único evita el duplicado en carreras
    else return { created, existing, without_account, total: attempts.length, error: 'No se pudo crear un ticket; el resto no se procesó.' }
  }
  return { created, existing, without_account, total: attempts.length }
}

/**
 * Contador de Soporte del menú: solo lo que espera nuestra atención. Cuenta un ticket activo cuando
 *  - es nuevo y nadie del equipo respondió todavía, o
 *  - la persona respondió después de nuestro último mensaje.
 * No cuenta los pendientes que ya respondimos ni los tickets que crea «Actualizar Pro» (nacen sin que la
 * influencer haya escrito nada) hasta que ella conteste.
 */
export function countTicketsAwaitingTeam(
  tickets: Array<{ id: string; category?: string | null }>,
  replies: Array<{ ticket_id: string; is_admin: boolean | null; created_at: string }>,
): number {
  const lastAdmin = new Map<string, string>()
  const lastUser = new Map<string, string>()
  for (const r of replies) {
    const bucket = r.is_admin ? lastAdmin : lastUser
    const prev = bucket.get(r.ticket_id)
    if (!prev || r.created_at > prev) bucket.set(r.ticket_id, r.created_at)
  }
  let count = 0
  for (const t of tickets) {
    const admin = lastAdmin.get(t.id), user = lastUser.get(t.id)
    if (user && (!admin || user > admin)) count++
    else if (!user && !admin && t.category !== PRO_CATEGORY) count++
  }
  return count
}
