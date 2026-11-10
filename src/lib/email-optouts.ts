import { createHmac, timingSafeEqual } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

// ─────────────────────────────────────────────────────────────────────────────
// Opt-out COMERCIAL. Fuente única de verdad: tabla `email_optouts`.
//
// REGLA QUE NO SE ROMPE: este módulo lo importan SOLO los dos caminos
// comerciales del CRM (src/lib/crm-bulk-send.ts y
// api/crm-leads/[id]/send-intro) más el webhook que alimenta la tabla y la
// ruta pública de baja. Los ~39 puntos de envío transaccional (accesos,
// aprobaciones, facturas, reportes, campañas, soporte) NO deben importarlo:
// alguien dado de baja de la prospección sigue recibiendo su contraseña.
// Hay un test que verifica esto (tests/email-optouts.test.ts).
// ─────────────────────────────────────────────────────────────────────────────

export type OptOutReason = 'unsubscribe' | 'bounce' | 'complaint' | 'manual'

/**
 * La consulta a `email_optouts` no se pudo completar.
 *
 * FAIL CLOSED: si no podemos comprobar la lista de bajas, NO se manda correo
 * comercial. Mandar "por si acaso" es exactamente lo que produce reenvíos a
 * gente que se dio de baja o que rebotó de forma permanente.
 */
export class OptOutLookupError extends Error {
  constructor(cause: unknown) {
    super(`No se pudo verificar la lista de bajas: ${cause instanceof Error ? cause.message : String(cause)}`)
    this.name = 'OptOutLookupError'
  }
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'
const UNSUBSCRIBE_MAILTO = process.env.UNSUBSCRIBE_MAILTO ?? 'hola@scence.cl'

/** Minúsculas y sin espacios — mismo criterio que la constraint de la tabla. */
export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase()
}

// ── Token de baja ───────────────────────────────────────────────────────────
// HMAC sobre el id del lead. No hay tabla de tokens ni PII en la URL: el email
// se resuelve en el servidor. Reusa INTERNAL_JOB_SECRET (ya configurado en
// producción para el bulk-send) salvo que se defina UNSUBSCRIBE_SECRET.
function unsubscribeSecret(): string | null {
  return process.env.UNSUBSCRIBE_SECRET || process.env.INTERNAL_JOB_SECRET || null
}

export function signUnsubscribeToken(leadId: string): string | null {
  const secret = unsubscribeSecret()
  if (!secret) return null
  return createHmac('sha256', secret).update(`unsubscribe:${leadId}`).digest('base64url')
}

export function verifyUnsubscribeToken(leadId: string, token: string | null | undefined): boolean {
  const expected = signUnsubscribeToken(leadId)
  if (!expected || !token) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(token)
  // timingSafeEqual exige mismo largo; comparar largos primero no filtra nada
  // útil porque el largo del HMAC es fijo y público.
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** URL pública de baja para un lead. `null` si no hay secreto configurado. */
export function buildUnsubscribeUrl(leadId: string, appUrl: string = APP_URL): string | null {
  const token = signUnsubscribeToken(leadId)
  if (!token) return null
  return `${appUrl}/api/unsubscribe?l=${encodeURIComponent(leadId)}&t=${token}`
}

/**
 * Headers de baja para emails COMERCIALES (RFC 2369 + RFC 8058).
 * `List-Unsubscribe-Post` es lo que habilita el botón nativo de un clic en
 * Gmail y Outlook; sin él, el header de arriba solo es informativo.
 */
export function commercialEmailHeaders(unsubscribeUrl: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${unsubscribeUrl}>, <mailto:${UNSUBSCRIBE_MAILTO}?subject=unsubscribe>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
}

// ── Clasificación de eventos de Resend ──────────────────────────────────────
type ResendEventData = { bounce?: { type?: string | null; subType?: string | null } | null } | null | undefined

/**
 * Decide si un evento de Resend debe bloquear comercialmente esa dirección.
 *
 * Un rebote TRANSIENT (buzón lleno, fallo temporal) NO bloquea: es
 * recuperable y bloquearlo perdería leads válidos. Si Resend no informa el
 * tipo, tampoco se bloquea — ante la duda, no se destruye un lead; los casos
 * reales terminan llegando igual como `email.suppressed`.
 */
export function classifyResendEvent(
  eventType: string,
  data: ResendEventData,
): { block: boolean; reason: OptOutReason | null; detail: string | null } {
  if (eventType === 'email.complained') {
    return { block: true, reason: 'complaint', detail: 'Marcado como spam' }
  }

  if (eventType === 'email.suppressed') {
    return { block: true, reason: 'bounce', detail: 'Suprimido por Resend' }
  }

  if (eventType === 'email.bounced') {
    const type = (data?.bounce?.type ?? '').toString().trim().toLowerCase()
    const subType = data?.bounce?.subType ?? null
    if (type === 'permanent') {
      return { block: true, reason: 'bounce', detail: `Rebote permanente${subType ? ` (${subType})` : ''}` }
    }
    return { block: false, reason: null, detail: `Rebote ${type || 'sin tipo'}${subType ? ` (${subType})` : ''} — no bloquea` }
  }

  return { block: false, reason: null, detail: null }
}

// ── Acceso a la tabla ───────────────────────────────────────────────────────
type Admin = SupabaseClient<any, any, any>

const IN_CHUNK = 200

function chunk<T>(values: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size))
  return out
}

/**
 * Direcciones bloqueadas dentro del lote. Devuelve un Set normalizado.
 *
 * FAIL CLOSED: si la consulta falla lanza OptOutLookupError. Quien llama debe
 * abortar el envío comercial — nunca continuar. Los envíos transaccionales no
 * pasan por acá y no se ven afectados.
 */
export async function getBlockedEmails(admin: Admin, emails: Array<string | null | undefined>): Promise<Set<string>> {
  const normalized = Array.from(new Set(emails.map(normalizeEmail).filter(Boolean)))
  const blocked = new Set<string>()
  if (normalized.length === 0) return blocked

  for (const part of chunk(normalized, IN_CHUNK)) {
    let result: { data: Array<{ email: string | null }> | null; error: unknown }
    try {
      result = await admin.from('email_optouts').select('email').in('email', part)
    } catch (cause) {
      console.error('[email-optouts] la consulta de bajas lanzó una excepción', cause)
      throw new OptOutLookupError(cause)
    }

    if (result.error) {
      console.error('[email-optouts] no se pudo consultar la lista de bajas', result.error)
      throw new OptOutLookupError(result.error)
    }

    for (const row of result.data ?? []) if (row?.email) blocked.add(normalizeEmail(row.email))
  }

  return blocked
}

/** Propaga OptOutLookupError: quien llama debe abortar el envío comercial. */
export async function isOptedOut(admin: Admin, email: string | null | undefined): Promise<boolean> {
  const normalized = normalizeEmail(email)
  if (!normalized) return false
  const blocked = await getBlockedEmails(admin, [normalized])
  return blocked.has(normalized)
}

/**
 * Registra una baja. Idempotente: repetirla no duplica ni falla, y conserva
 * el primer motivo registrado.
 */
export async function recordOptOut(
  admin: Admin,
  input: { email: string | null | undefined; reason: OptOutReason; source?: string | null; leadId?: string | null; resendEmailId?: string | null },
): Promise<{ ok: boolean; email: string; inserted: boolean }> {
  const email = normalizeEmail(input.email)
  if (!email) return { ok: false, email: '', inserted: false }

  // ignoreDuplicates => ON CONFLICT DO NOTHING: repetir una baja no falla ni
  // pisa el motivo original. `select` devuelve filas solo cuando insertó, así
  // que sirve para no duplicar la nota en el timeline.
  const { data, error } = await admin
    .from('email_optouts')
    .upsert(
      {
        email,
        reason: input.reason,
        source: input.source ?? null,
        lead_id: input.leadId ?? null,
        resend_email_id: input.resendEmailId ?? null,
      },
      { onConflict: 'email', ignoreDuplicates: true },
    )
    .select('email')

  if (error) {
    console.error('[email-optouts] no se pudo registrar la baja', error)
    return { ok: false, email, inserted: false }
  }

  return { ok: true, email, inserted: (data?.length ?? 0) > 0 }
}
