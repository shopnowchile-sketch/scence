import { createAdminClient } from '@/lib/supabase/server'

/**
 * REGLA DE NEGOCIO: INFLUENCER INACTIVA = CERO EMAILS DE SCENCE.
 *
 * Barrera final antes de cualquier envío: `getResend()` (lib/resend.ts) la aplica
 * a TODO `emails.send` y `batch.send`. Ningún endpoint, cron o webhook —actual o
 * futuro— puede enviarle un email a una influencer con `is_active = false`.
 *
 * Decisión por destinatario:
 *
 *   ¿El email pertenece a una influencer inactiva?
 *     NO → envío normal (marcas, admins, influencers activas, cualquier otro).
 *     SÍ → ¿el envío va dirigido a otro rol (audiencia 'brand' | 'admin' | 'crm' | 'account')
 *           Y la base confirma que ese email tiene ese otro rol en SCENCE?
 *             SÍ → enviar (es una marca/admin/lead que comparte email).
 *             NO → BLOQUEAR.
 *
 * La audiencia la declara quien envía con `tags: [emailAudience('brand')]`.
 * Por defecto (sin tag) un envío se trata como dirigido a influencer, así un
 * endpoint nuevo que olvide declararla nunca le escribe a una inactiva.
 * Declarar una audiencia NO basta por sí solo: el rol se confirma en la base.
 *
 * Falla CERRADO: si no se puede verificar, no se envía.
 */

export type EmailAudience = 'influencer' | 'brand' | 'admin' | 'crm' | 'account'
export const EMAIL_AUDIENCE_TAG = 'scence_audience'

/** Tag para declarar la audiencia de un envío: `tags: [emailAudience('brand')]`. */
export function emailAudience(audience: Exclude<EmailAudience, 'influencer'>) {
  return { name: EMAIL_AUDIENCE_TAG, value: audience }
}

type InactiveInfluencer = { userIds: string[]; organizationIds: string[] }
const PAGE = 1000

export async function getInactiveInfluencers(): Promise<Map<string, InactiveInfluencer>> {
  const admin = createAdminClient()
  const result = new Map<string, InactiveInfluencer>()
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from('influencers')
      .select('email, user_id, organization_id')
      .eq('is_active', false)
      .not('email', 'is', null)
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`[email-guard] no se pudo consultar influencers inactivas: ${error.message}`)
    for (const row of data ?? []) {
      const email = normalizeEmail(row.email)
      if (!email) continue
      const entry = result.get(email) ?? { userIds: [], organizationIds: [] }
      if (row.user_id) entry.userIds.push(row.user_id)
      if (row.organization_id) entry.organizationIds.push(row.organization_id)
      result.set(email, entry)
    }
    if (!data || data.length < PAGE) break
  }
  return result
}

/** Extrae la dirección de "Nombre <correo@x.cl>" y la normaliza. */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = value.match(/<([^>]+)>/)
  const email = (match ? match[1] : value).trim().toLowerCase()
  return email || null
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, char => `\\${char}`)
}

const INTERNAL_ADDRESSES = () => [
  process.env.ADMIN_NOTIFICATION_EMAIL, process.env.ADMIN_PAYMENT_EMAIL,
  process.env.SUPPORT_EMAIL, process.env.APPROVAL_EMAIL, 'hola.scence@gmail.com',
].map(normalizeEmail).filter((email): email is string => Boolean(email))

/**
 * Confirma en la base que `email` (que pertenece a una influencer inactiva)
 * también tiene el rol no-influencer al que va dirigido el envío.
 */
export async function hasNonInfluencerRole(email: string, audience: EmailAudience, inactive: InactiveInfluencer): Promise<boolean> {
  if (audience === 'influencer') return false
  if (INTERNAL_ADDRESSES().includes(email) && audience === 'admin') return true

  const admin = createAdminClient()
  const pattern = escapeLike(email)
  const checks: Array<PromiseLike<{ count: number | null; error: { message: string } | null }>> = []
  const count = (query: PromiseLike<{ count: number | null; error: { message: string } | null }>) => checks.push(query)

  // Misma cuenta (mismo email = mismo usuario de Auth) con membresía activa en una
  // organización que no es la de la influencer: marca o equipo SCENCE.
  if (inactive.userIds.length) {
    let membership = admin.from('organization_members').select('id', { count: 'exact', head: true })
      .in('user_id', inactive.userIds).eq('is_active', true)
    if (inactive.organizationIds.length) membership = membership.not('organization_id', 'in', `(${inactive.organizationIds.join(',')})`)
    count(membership)
    count(admin.from('brand_members').select('id', { count: 'exact', head: true }).in('user_id', inactive.userIds).eq('is_active', true))
  }
  if (audience === 'brand' || audience === 'account' || audience === 'admin') {
    count(admin.from('brand_members').select('id', { count: 'exact', head: true }).ilike('email', pattern).eq('is_active', true))
  }
  if (audience === 'brand') {
    count(admin.from('brands').select('id', { count: 'exact', head: true }).ilike('contact_email', pattern))
    count(admin.from('brand_documents').select('id', { count: 'exact', head: true }).ilike('signer_email', pattern))
    count(admin.from('organizations').select('id', { count: 'exact', head: true }).ilike('billing_email', pattern))
  }
  if (audience === 'crm') {
    count(admin.from('crm_leads').select('id', { count: 'exact', head: true }).ilike('email', pattern))
  }

  const results = await Promise.all(checks)
  for (const result of results) {
    if (result.error) throw new Error(`[email-guard] no se pudo verificar el rol del destinatario: ${result.error.message}`)
  }
  return results.some(result => (result.count ?? 0) > 0)
}

type RecipientField = string | string[] | undefined | null
type EmailPayload = { to?: RecipientField; cc?: RecipientField; bcc?: RecipientField; tags?: unknown } & Record<string, unknown>

export function audienceOf(payload: EmailPayload): EmailAudience {
  const tags = Array.isArray(payload.tags) ? payload.tags as Array<{ name?: string; value?: string }> : []
  const value = tags.find(tag => tag?.name === EMAIL_AUDIENCE_TAG)?.value
  return value === 'brand' || value === 'admin' || value === 'crm' || value === 'account' ? value : 'influencer'
}

/**
 * Aplica la regla a un payload. Devuelve `payload: null` si no queda ningún
 * destinatario en `to` (el email NO se envía).
 */
export async function applyInactiveInfluencerRule<T extends EmailPayload>(
  payload: T,
  inactive: Map<string, InactiveInfluencer>,
  resolveRole: typeof hasNonInfluencerRole = hasNonInfluencerRole,
): Promise<{ payload: T | null; removed: number }> {
  const audience = audienceOf(payload)
  const cache = new Map<string, boolean>()
  const allowed = async (address: string) => {
    const email = normalizeEmail(address)
    if (!email) return true
    const entry = inactive.get(email)
    if (!entry) return true // no es influencer inactiva → envío normal
    if (!cache.has(email)) cache.set(email, await resolveRole(email, audience, entry))
    return cache.get(email) as boolean
  }
  const strip = async (field: RecipientField) => {
    if (field == null) return { value: undefined as string | string[] | undefined, removed: 0 }
    const list = Array.isArray(field) ? field : [field]
    const kept: string[] = []
    for (const address of list) if (await allowed(address)) kept.push(address)
    const removed = list.length - kept.length
    return { value: kept.length === 0 ? undefined : (Array.isArray(field) ? kept : kept[0]), removed }
  }
  const to = await strip(payload.to)
  const cc = await strip(payload.cc)
  const bcc = await strip(payload.bcc)
  const removed = to.removed + cc.removed + bcc.removed
  if (removed === 0) return { payload, removed }
  if (to.value === undefined) return { payload: null, removed }
  const next = { ...payload, to: to.value } as T
  if (payload.cc != null) (next as EmailPayload).cc = cc.value
  if (payload.bcc != null) (next as EmailPayload).bcc = bcc.value
  return { payload: next, removed }
}
