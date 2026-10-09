import { createHash } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

// Protección temporal contra envíos duplicados de CRM. NO garantiza entrega
// exactamente una vez: Resend (SDK 3.x) no ofrece clave de idempotencia, así
// que la exclusión se resuelve en nuestra base y solo cubre una ventana.
//
// La reserva es un UPDATE condicional sobre `crm_leads.contacted_at`. Postgres
// toma el lock de la fila y, bajo READ COMMITTED, la segunda solicitud
// concurrente reevalúa el WHERE contra el valor ya actualizado y no modifica
// nada. No requiere migración.
export const SEND_GUARD_WINDOW_MS = 10 * 60 * 1000

export type SendClaim =
  | { claimed: true; claimedAt: string; previous: string | null }
  | { claimed: false; reason: 'recent'; contactedAt: string | null }
  | { claimed: false; reason: 'error'; message: string }

/** Reserva el envío al lead. `claimed: false` => NO llamar a Resend. */
export async function claimLeadSend(
  admin: SupabaseClient,
  leadId: string,
  previous: string | null,
  now: Date = new Date(),
): Promise<SendClaim> {
  const claimedAt = now.toISOString()
  const cutoff = new Date(now.getTime() - SEND_GUARD_WINDOW_MS).toISOString()

  const { data, error } = await admin
    .from('crm_leads')
    .update({ contacted_at: claimedAt })
    .eq('id', leadId)
    .or(`contacted_at.is.null,contacted_at.lt.${cutoff}`)
    .select('id')

  if (error) return { claimed: false, reason: 'error', message: error.message }
  if (!data || data.length === 0) return { claimed: false, reason: 'recent', contactedAt: previous }
  return { claimed: true, claimedAt, previous }
}

/**
 * Libera la reserva SOLO cuando se sabe con certeza que el email no salió
 * (Resend rechazó la solicitud). Restaura `contacted_at` únicamente si sigue
 * siendo el valor reservado, para no pisar otra escritura posterior.
 */
export async function releaseLeadSend(admin: SupabaseClient, leadId: string, claim: Extract<SendClaim, { claimed: true }>) {
  return admin
    .from('crm_leads')
    .update({ contacted_at: claim.previous })
    .eq('id', leadId)
    .eq('contacted_at', claim.claimedAt)
}

// Errores con los que Resend responde que la solicitud NO se procesó por un
// problema nuestro (validación, auth, cuota). Un error 5xx o una excepción de
// red son ambiguos: el correo pudo haberse aceptado.
const AMBIGUOUS_RESEND_ERRORS = new Set(['application_error', 'internal_server_error'])

export function isDefinitiveResendFailure(error: { name?: string } | null | undefined): boolean {
  return !!error && !AMBIGUOUS_RESEND_ERRORS.has(String(error.name ?? ''))
}

// ════════════════════════════════════════════════════════════════════════════
// Envío masivo: bloqueo del job y procesamiento de una tanda.
//
// LÍMITES (sin migración): no garantiza entrega exactamente una vez. La reserva por
// lead dura SEND_GUARD_WINDOW_MS; el bloqueo del job usa la columna `error` como
// marcador temporal porque la tabla no tiene una columna de lease (agregarla es una
// migración). Resend (SDK 3.x) no ofrece clave de idempotencia.
// ════════════════════════════════════════════════════════════════════════════

/** Una tanda dura como máximo `maxDuration` (60 s): un lease de 3 min cubre con holgura. */
export const JOB_LEASE_MS = 3 * 60 * 1000
/** Un job más viejo que esto NUNCA se procesa: evita reactivar campañas históricas. */
export const JOB_MAX_AGE_MS = 12 * 60 * 60 * 1000

const LEASE_PREFIX = 'lease:'

export type JobRow = { id: string; status: string; cursor: number; created_at: string; error: string | null }

export function buildLeaseMarker(token: string, expiresAt: Date): string {
  return `${LEASE_PREFIX}${expiresAt.toISOString()}:${token}`
}

const LEASE_PATTERN = /^lease:(\d{4}-\d{2}-\d{2}T[\d:.]+Z):(.+)$/

export function parseLease(error: string | null | undefined): { expiresAt: Date; token: string } | null {
  const match = error ? LEASE_PATTERN.exec(error) : null
  if (!match) return null
  const expiresAt = new Date(match[1])
  return Number.isNaN(expiresAt.getTime()) ? null : { expiresAt, token: match[2] }
}

export type JobClaim =
  | { ok: true; marker: string }
  | { ok: false; reason: 'closed' | 'too_old' | 'busy' | 'error'; message?: string }

/**
 * Toma el job para procesar UNA tanda. Compare-and-set sobre (cursor, error): de dos
 * invocaciones simultáneas que leyeron el mismo estado, solo una modifica la fila.
 * Rechaza jobs cerrados y jobs viejos (no reactiva los históricos).
 */
export async function claimJobBatch(
  admin: SupabaseClient,
  job: JobRow,
  now: Date = new Date(),
  token: string = globalThis.crypto.randomUUID(),
): Promise<JobClaim> {
  if (job.status !== 'pending' && job.status !== 'processing') return { ok: false, reason: 'closed' }
  if (now.getTime() - new Date(job.created_at).getTime() > JOB_MAX_AGE_MS) return { ok: false, reason: 'too_old' }

  const held = parseLease(job.error)
  if (held && held.expiresAt.getTime() > now.getTime()) return { ok: false, reason: 'busy' }

  const marker = buildLeaseMarker(token, new Date(now.getTime() + JOB_LEASE_MS))
  let query = admin
    .from('crm_bulk_send_jobs')
    .update({ status: 'processing', error: marker, updated_at: now.toISOString() })
    .eq('id', job.id)
    .eq('cursor', job.cursor)
    .in('status', ['pending', 'processing'])
  query = job.error === null ? query.is('error', null) : query.eq('error', job.error)

  const { data, error } = await query.select('id')
  if (error) return { ok: false, reason: 'error', message: error.message }
  if (!data || data.length === 0) return { ok: false, reason: 'busy' }
  return { ok: true, marker }
}

/** Aplica el avance SOLO si seguimos teniendo el lease. `false` => lo perdimos: no encadenar. */
export async function finishJobBatch(
  admin: SupabaseClient,
  jobId: string,
  marker: string,
  patch: Record<string, unknown>,
): Promise<{ held: boolean; row: Record<string, unknown> | null; message?: string }> {
  const { data, error } = await admin
    .from('crm_bulk_send_jobs')
    .update({ ...patch, error: null })
    .eq('id', jobId)
    .eq('error', marker)
    .select('*')
  if (error) return { held: false, row: null, message: error.message }
  if (!data || data.length === 0) return { held: false, row: null }
  return { held: true, row: data[0] as Record<string, unknown> }
}

/** Marca el job como fallido (conserva el cursor) y libera el lease. */
export async function failJobBatch(admin: SupabaseClient, jobId: string, marker: string, message: string) {
  return admin
    .from('crm_bulk_send_jobs')
    .update({ status: 'failed', error: message, updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('error', marker)
}

const LEDGER_EVENT_TYPES = ['email.sent', 'email.send_unconfirmed']

/** Leads de la tanda que YA tienen un envío (confirmado o no confirmado) registrado en ESTE job. Falla cerrado. */
export async function loadHandledLeadIds(admin: SupabaseClient, jobId: string, leadIds: string[]): Promise<Set<string>> {
  if (leadIds.length === 0) return new Set()
  const { data, error } = await admin
    .from('crm_email_events')
    .select('lead_id')
    .in('lead_id', leadIds)
    .in('event_type', LEDGER_EVENT_TYPES)
    .filter('raw_payload->>job_id', 'eq', jobId)
  if (error) throw new Error(`No se pudo verificar los envíos previos del job: ${error.message}`)
  return new Set((data ?? []).map(row => row.lead_id as string))
}

/**
 * Intentos interrumpidos: leads reservados (contacted_at desde `since`) sin ningún
 * evento de este job. NO se reenvían solos; es una lista para revisión manual.
 */
export async function listInterruptedAttempts(
  admin: SupabaseClient,
  jobId: string,
  leadIds: string[],
  since: string,
): Promise<string[]> {
  if (leadIds.length === 0) return []
  const [handled, leads] = await Promise.all([
    loadHandledLeadIds(admin, jobId, leadIds),
    admin.from('crm_leads').select('id, contacted_at').in('id', leadIds).gte('contacted_at', since),
  ])
  if (leads.error) throw new Error(leads.error.message)
  return (leads.data ?? []).map(row => row.id as string).filter(id => !handled.has(id))
}

export type BatchLead = {
  id: string
  contact_name: string | null
  company_name: string | null
  email: string | null
  qualification_status: string
  contacted_at: string | null
}

export type OutgoingEmail = {
  subject: string
  message: string
  templateKey: string
  templateName: string
  /** Llama al proveedor. Puede lanzar: una excepción cuenta como resultado AMBIGUO. */
  send: () => Promise<{ id: string | null; error: { name?: string; message?: string } | null }>
}

export interface BatchDeps {
  isBlocked(email: string): boolean
  /** null => no se puede armar el email (p. ej. sin link de baja): cuenta como fallo, no se envía. */
  prepare(lead: BatchLead): OutgoingEmail | null
  pause(): Promise<void>
}

export type BatchResult = {
  sent: number
  skipped: number
  failed: number
  /** Subconjunto de `failed`: el email pudo haber salido. No se reintenta solo. */
  unconfirmed: number
  alreadyHandled: number
  recentlyContacted: number
  /** Escrituras posteriores al envío que fallaron (el email SÍ salió). */
  recordErrors: number
}

export async function processLeadBatch(
  admin: SupabaseClient,
  params: { jobId: string; userId: string; leads: BatchLead[]; jobCreatedAt?: string },
  deps: BatchDeps,
): Promise<BatchResult> {
  const { jobId, userId, leads, jobCreatedAt } = params
  const jobStart = jobCreatedAt ? new Date(jobCreatedAt).getTime() : NaN
  const result: BatchResult = { sent: 0, skipped: 0, failed: 0, unconfirmed: 0, alreadyHandled: 0, recentlyContacted: 0, recordErrors: 0 }
  const handled = await loadHandledLeadIds(admin, jobId, leads.map(lead => lead.id))

  for (const lead of leads) {
    if (!lead.email) { result.skipped++; continue }

    if (deps.isBlocked(lead.email)) {
      result.skipped++
      await admin.from('crm_lead_activities').insert({
        lead_id: lead.id,
        action_type: 'note',
        description: `Envío comercial omitido: ${lead.email} está en la lista de bajas (unsubscribe, rebote permanente o queja de spam).`,
        created_by: userId,
      })
      continue
    }

    if (handled.has(lead.id)) { result.skipped++; result.alreadyHandled++; continue }

    // Intento INTERRUMPIDO: el lead quedó reservado después de que arrancó este job y no tiene ningún
    // evento de este job. Pudo haber salido (Resend acepta y el proceso muere antes de registrar).
    // La ventana de 10 min no basta: pasada esa ventana la reserva ya no protege. NO se envía; se deja
    // registrado como no confirmado para revisión manual (mismo criterio que la reanudación manual).
    if (lead.contacted_at && !Number.isNaN(jobStart) && new Date(lead.contacted_at).getTime() >= jobStart) {
      result.failed++
      result.unconfirmed++
      console.error('[crm-bulk-send] intento previo sin registro en este job — NO se reenvía', { leadId: lead.id, jobId })
      const { error } = await admin.from('crm_email_events').insert({
        lead_id: lead.id,
        resend_email_id: null,
        event_type: 'email.send_unconfirmed',
        recipient_email: lead.email,
        subject: null,
        raw_payload: { source: 'bulk-send-guard', job_id: jobId, resolution: 'no_provider_evidence', claimed_at: lead.contacted_at },
      })
      if (error) result.recordErrors++
      await admin.from('crm_lead_activities').insert({
        lead_id: lead.id,
        action_type: 'note',
        description: `Job ${jobId}: este lead ya estaba reservado por un intento previo sin registro. NO se reenvía automáticamente; revisar en Resend.`,
        created_by: userId,
      })
      continue
    }

    const outgoing = deps.prepare(lead)
    if (!outgoing) { result.failed++; continue }

    // Reserva atómica por lead: la misma que el envío individual.
    const claim = await claimLeadSend(admin, lead.id, lead.contacted_at ?? null)
    if (!claim.claimed) {
      if (claim.reason === 'error') {
        console.error('[crm-bulk-send] no se pudo reservar el envío — no se envía', { leadId: lead.id, message: claim.message })
        result.failed++
      } else {
        result.skipped++
        result.recentlyContacted++
      }
      continue
    }

    let resendId: string | null = null
    let providerError: { name?: string; message?: string } | null = null
    let thrown: unknown = null
    try {
      const response = await outgoing.send()
      resendId = response.id
      providerError = response.error
    } catch (error) {
      thrown = error
    }

    if (thrown || (providerError && !isDefinitiveResendFailure(providerError))) {
      // AMBIGUO: pudo haber salido. Se conserva la reserva y NO se reintenta.
      const detail = thrown instanceof Error ? thrown.message : providerError?.message ?? 'error desconocido'
      console.error('[crm-bulk-send] resultado ambiguo de Resend — reserva conservada', { leadId: lead.id, jobId, detail })
      result.failed++
      result.unconfirmed++
      const { error } = await admin.from('crm_email_events').insert({
        lead_id: lead.id,
        resend_email_id: null,
        event_type: 'email.send_unconfirmed',
        recipient_email: lead.email,
        subject: outgoing.subject,
        raw_payload: { source: 'bulk-send', job_id: jobId, template_key: outgoing.templateKey, error: detail },
      })
      if (error) result.recordErrors++
      continue
    }

    if (providerError) {
      // Rechazo definitivo: no salió. Se libera la reserva.
      const released = await releaseLeadSend(admin, lead.id, claim)
      if (released.error) console.error('[crm-bulk-send] no se pudo liberar la reserva', released.error)
      result.failed++
      await admin.from('crm_lead_activities').insert({
        lead_id: lead.id,
        action_type: 'email_sent',
        description: `Envío masivo falló a ${lead.email}: ${providerError.message ?? 'error desconocido'}`,
        created_by: userId,
      })
      continue
    }

    result.sent++
    // El email YA salió: si un registro falla no se revierte ni se reenvía.
    const now = new Date().toISOString()
    const entersPipeline = lead.qualification_status === 'unqualified' || lead.qualification_status === 'qualified'
    const writes = await Promise.all([
      admin.from('crm_email_events').insert({
        lead_id: lead.id,
        resend_email_id: resendId,
        event_type: 'email.sent',
        recipient_email: lead.email,
        subject: outgoing.subject,
        raw_payload: {
          source: 'bulk-send',
          job_id: jobId,
          email_type: outgoing.templateName,
          template_key: outgoing.templateKey,
          resend_email_id: resendId,
          // El contenido NO se copia por lead: asunto y mensaje del job viven en
          // crm_bulk_send_jobs (job_id) y el asunto resuelto en la columna `subject`.
        },
      }),
      admin.from('crm_leads').update({
        contacted_at: now,
        updated_at: now,
        ...(entersPipeline ? { qualification_status: 'contacted' } : {}),
      }).eq('id', lead.id),
      admin.from('crm_lead_activities').insert({
        lead_id: lead.id,
        action_type: 'email_sent',
        description: `Tipo: ${outgoing.templateName} · Para: ${lead.email} · Asunto: ${outgoing.subject}`,
        created_by: userId,
      }),
    ])
    const failedWrites = writes.filter(write => write.error)
    if (failedWrites.length > 0) {
      result.recordErrors += failedWrites.length
      console.error('[crm-bulk-send] email enviado pero falló el registro — NO reenviar', { leadId: lead.id, jobId, resendId, errors: failedWrites.map(w => w.error?.message) })
    }

    await deps.pause()
  }

  return result
}

// ════════════════════════════════════════════════════════════════════════════
// Reanudación MANUAL de un job interrumpido (solo administradores del CRM).
//
// Principios:
//  * Nunca se reanuda sola: la dispara una persona, con confirmación y sobre el estado que acaba de ver.
//  * Nunca reabre un job cerrado (`failed`/`completed`) ni uno de más de JOB_MAX_AGE_MS.
//  * Los envíos INCIERTOS no se repiten: se registran como `email.send_unconfirmed` (el ledger los bloquea).
//  * Si no se puede determinar con seguridad qué pasó, se DETIENE y se pide revisión manual.
//  * Toda decisión queda registrada: quién, cuándo, qué job y qué se decidió por cada lead.
// ════════════════════════════════════════════════════════════════════════════
/** Tamaño de tanda del procesador (también lo usa crm-bulk-send.ts). */
export const BATCH_SIZE = 50

export type BlockerCode = 'not_found' | 'closed' | 'too_old' | 'busy' | 'manual_review'
export type Blocker = { code: BlockerCode; message: string }

export type InterruptedAttempt = {
  leadId: string
  claimedAt: string
  /** `provider_activity_seen`: Resend registró actividad para ese destinatario tras la reserva. `no_provider_evidence`: nada. En ambos casos NO se reenvía. */
  resolution: 'provider_activity_seen' | 'no_provider_evidence'
  evidence: Array<{ id: string; event_type: string; created_at: string }>
}

export type JobReport = {
  job: { id: string; status: string; cursor: number; total: number; sent: number; skipped: number; failed: number; created_at: string; updated_at: string; remaining: number; ageMs: number }
  counts: {
    /** Envíos confirmados registrados por este job (`email.sent` con su job_id). */
    confirmed: number
    /** Rechazos definitivos del proveedor (el email NO salió): `failed` del job menos los inciertos registrados. */
    definitiveFailed: number
    /** Inciertos ya registrados (`email.send_unconfirmed` con su job_id): pendientes de revisión manual, nunca se repiten. */
    uncertainRecorded: number
  }
  lease: { active: boolean; expiresAt: string | null }
  interrupted: InterruptedAttempt[]
  blockers: Blocker[]
  resumable: boolean
  fingerprint: string
}

export type InspectResult = { ok: true; report: JobReport } | { ok: false; status: number; blockers: Blocker[] }

type InspectOptions = { now?: Date; ownLeaseMarker?: string | null }

function fingerprintOf(r: Omit<JobReport, 'fingerprint' | 'resumable' | 'blockers' | 'lease'>): string {
  // pending y processing son el mismo estado "abierto" (tomar el bloqueo convierte uno en otro).
  const stable = [r.job.status === 'pending' || r.job.status === 'processing' ? 'open' : r.job.status, r.job.cursor, r.job.total, r.job.sent, r.job.skipped, r.job.failed, r.counts.confirmed, r.counts.uncertainRecorded,
    r.interrupted.map(i => i.leadId).sort()]
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex').slice(0, 32)
}

/**
 * Lee el estado ACTUAL del job y decide si es reanudable. Solo lectura.
 * Cualquier consulta que falle => bloqueo `manual_review` (nunca se asume nada).
 */
export async function inspectJob(admin: SupabaseClient, jobId: string, options: InspectOptions = {}): Promise<InspectResult> {
  const now = options.now ?? new Date()
  const { data: job, error } = await admin
    .from('crm_bulk_send_jobs')
    .select('id, status, cursor, total, sent, skipped, failed, error, created_at, updated_at, lead_ids')
    .eq('id', jobId)
    .maybeSingle()
  if (error) return { ok: false, status: 500, blockers: [{ code: 'manual_review', message: `No se pudo leer el job: ${error.message}` }] }
  if (!job) return { ok: false, status: 404, blockers: [{ code: 'not_found', message: 'Job no encontrado' }] }

  const blockers: Blocker[] = []
  const ageMs = now.getTime() - new Date(job.created_at).getTime()
  const leadIds: string[] = job.lead_ids ?? []

  if (job.status !== 'pending' && job.status !== 'processing') {
    const statusLabel = job.status === 'failed' ? 'cerrado o fallido' : job.status === 'completed' ? 'completado' : job.status
    blockers.push({ code: 'closed', message: `El envío está ${statusLabel}: un envío cerrado no se reabre` })
  }
  if (ageMs > JOB_MAX_AGE_MS) {
    blockers.push({ code: 'too_old', message: 'El job tiene más de 12 horas: no se reanuda. Crea un job nuevo si todavía corresponde' })
  }

  const held = parseLease(job.error)
  const ownLease = options.ownLeaseMarker && job.error === options.ownLeaseMarker
  const leaseActive = Boolean(held && held.expiresAt.getTime() > now.getTime() && !ownLease)
  if (leaseActive) blockers.push({ code: 'busy', message: 'Otra invocación está procesando este job ahora mismo' })
  if (job.error && !held) {
    blockers.push({ code: 'manual_review', message: 'El job tiene un mensaje de error previo inesperado: revisar a mano antes de reanudar' })
  }
  if (job.sent + job.skipped + job.failed !== job.cursor) {
    blockers.push({ code: 'manual_review', message: `Los contadores no cuadran con el cursor (${job.sent}+${job.skipped}+${job.failed} ≠ ${job.cursor}): no se puede determinar con seguridad qué se envió` })
  }

  const batchIds = leadIds.slice(job.cursor, job.cursor + BATCH_SIZE)
  const interrupted: InterruptedAttempt[] = []
  let confirmed = 0
  let uncertainRecorded = 0

  // Si el job ya está bloqueado por otro motivo no tiene sentido seguir consultando el detalle.
  const canInspectDetail = !blockers.some(b => b.code === 'closed' || b.code === 'too_old')
  if (canInspectDetail) {
    try {
      const [handled, leads, confirmedCount, uncertainCount] = await Promise.all([
        loadHandledLeadIds(admin, jobId, batchIds),
        batchIds.length
          ? admin.from('crm_leads').select('id, contacted_at').in('id', batchIds)
          : Promise.resolve({ data: [] as Array<{ id: string; contacted_at: string | null }>, error: null }),
        admin.from('crm_email_events').select('id', { count: 'exact', head: true }).eq('event_type', 'email.sent').filter('raw_payload->>job_id', 'eq', jobId),
        admin.from('crm_email_events').select('id', { count: 'exact', head: true }).eq('event_type', 'email.send_unconfirmed').filter('raw_payload->>job_id', 'eq', jobId),
      ])
      if (leads.error) throw new Error(leads.error.message)
      if (confirmedCount.error) throw new Error(confirmedCount.error.message)
      if (uncertainCount.error) throw new Error(uncertainCount.error.message)
      confirmed = confirmedCount.count ?? 0
      uncertainRecorded = uncertainCount.count ?? 0

      // Reservado (contacted_at desde el inicio del job) y SIN ningún evento de este job => intento interrumpido.
      const candidates = (leads.data ?? []).filter(l => l.contacted_at && l.contacted_at >= job.created_at && !handled.has(l.id))
      // `candidates` nunca supera BATCH_SIZE: solo se examina la tanda en curso (cursor … cursor+BATCH_SIZE).
      if (candidates.length > 0) {
        const evidenceRes = await admin
          .from('crm_email_events')
          .select('id, lead_id, event_type, created_at')
          .in('lead_id', candidates.map(l => l.id))
          .gte('created_at', job.created_at)
          .not('raw_payload->>type', 'is', null)   // eventos del webhook de Resend (los nuestros llevan `source`, no `type`)
        if (evidenceRes.error) throw new Error(evidenceRes.error.message)
        for (const lead of candidates) {
          const seen = (evidenceRes.data ?? [])
            .filter(e => e.lead_id === lead.id && e.created_at >= (lead.contacted_at as string))
            .map(e => ({ id: e.id as string, event_type: e.event_type as string, created_at: e.created_at as string }))
          interrupted.push({
            leadId: lead.id,
            claimedAt: lead.contacted_at as string,
            resolution: seen.length > 0 ? 'provider_activity_seen' : 'no_provider_evidence',
            evidence: seen,
          })
        }
      }
    } catch (e) {
      blockers.push({ code: 'manual_review', message: `No se pudo comprobar con seguridad qué correos salieron (${e instanceof Error ? e.message : 'error'}). Revisar a mano` })
    }
  }

  const base = {
    job: {
      id: job.id, status: job.status, cursor: job.cursor, total: job.total, sent: job.sent, skipped: job.skipped, failed: job.failed,
      created_at: job.created_at, updated_at: job.updated_at, remaining: Math.max(0, job.total - job.cursor), ageMs,
    },
    counts: { confirmed, uncertainRecorded, definitiveFailed: Math.max(0, job.failed - uncertainRecorded) },
    interrupted,
  }
  return {
    ok: true,
    report: {
      ...base,
      lease: { active: leaseActive, expiresAt: held ? held.expiresAt.toISOString() : null },
      blockers,
      resumable: blockers.length === 0,
      fingerprint: fingerprintOf(base),
    },
  }
}

export type ResumeRequest = {
  jobId: string
  userId: string
  confirm: boolean
  /** Huella que el administrador vio en la consulta previa: si el estado cambió, se rechaza. */
  expectedFingerprint: string
  now?: Date
  token?: string
  meta?: { ip?: string | null; userAgent?: string | null; organizationId?: string | null }
}

export type ResumeResult =
  | { ok: true; decisions: InterruptedAttempt[]; report: JobReport; auditWarning?: string }
  | { ok: false; code: 'confirm_required' | 'stale_state' | 'not_resumable' | 'busy' | 'audit_failed' | 'incomplete' | 'lease_lost'; status: number; message: string; blockers?: Blocker[]; report?: JobReport }

/**
 * Prepara la reanudación: valida, toma el bloqueo del job, REGISTRA la solicitud, decide sobre los intentos
 * interrumpidos (sin reenviar) y libera el bloqueo SIN avanzar el cursor. Quien llama dispara luego el procesador.
 * Idempotente: repetirla no vuelve a registrar decisiones ya tomadas.
 */
export async function resumeJob(admin: SupabaseClient, req: ResumeRequest): Promise<ResumeResult> {
  const now = req.now ?? new Date()
  if (req.confirm !== true) return { ok: false, code: 'confirm_required', status: 422, message: 'Falta la confirmación explícita (confirm: true)' }

  const first = await inspectJob(admin, req.jobId, { now })
  if (!first.ok) return { ok: false, code: 'not_resumable', status: first.status, message: first.blockers[0]?.message ?? 'No reanudable', blockers: first.blockers }
  if (!first.report.resumable) {
    const busy = first.report.blockers.some(b => b.code === 'busy')
    return { ok: false, code: busy ? 'busy' : 'not_resumable', status: busy ? 409 : 422, message: first.report.blockers[0].message, blockers: first.report.blockers, report: first.report }
  }
  if (first.report.fingerprint !== req.expectedFingerprint) {
    return { ok: false, code: 'stale_state', status: 409, message: 'El estado del job cambió desde que lo consultaste. Vuelve a revisarlo antes de reanudar', report: first.report }
  }

  const { data: jobRow } = await admin.from('crm_bulk_send_jobs').select('id, status, cursor, created_at, error').eq('id', req.jobId).maybeSingle()
  if (!jobRow) return { ok: false, code: 'not_resumable', status: 404, message: 'Job no encontrado' }
  const claim = await claimJobBatch(admin, jobRow as JobRow, now, req.token)
  if (!claim.ok) {
    return { ok: false, code: claim.reason === 'busy' ? 'busy' : 'not_resumable', status: claim.reason === 'busy' ? 409 : 422, message: `No se pudo tomar el job (${claim.reason})` }
  }
  const marker = claim.marker
  const release = (patch: Record<string, unknown> = { updated_at: now.toISOString() }) => finishJobBatch(admin, req.jobId, marker, patch)
  const abort = async (result: ResumeResult): Promise<ResumeResult> => { await release(); return result }

  // Con el bloqueo en la mano, el estado puede haber cambiado entre medias: se vuelve a comprobar.
  const second = await inspectJob(admin, req.jobId, { now, ownLeaseMarker: marker })
  if (!second.ok || !second.report.resumable || second.report.fingerprint !== req.expectedFingerprint) {
    return abort({ ok: false, code: 'stale_state', status: 409, message: 'El estado del job cambió mientras se tomaba el bloqueo. No se hizo nada', report: second.ok ? second.report : undefined })
  }
  const decisions = second.report.interrupted

  // 1) Quedó constancia de la solicitud ANTES de tocar nada. Sin auditoría, no se continúa.
  const auditBase = { actor_id: req.userId, organization_id: req.meta?.organizationId ?? null, entity_type: 'crm_bulk_send_job', entity_id: req.jobId, ip_address: req.meta?.ip ?? null, user_agent: req.meta?.userAgent ?? null }
  const requested = await admin.from('audit_logs').insert({
    ...auditBase, action: 'crm.bulk_job.resume_requested',
    changes: { at: now.toISOString(), fingerprint: req.expectedFingerprint, job: { status: second.report.job.status, cursor: second.report.job.cursor, total: second.report.job.total }, interrupted_leads: decisions.length },
  })
  if (requested.error) return abort({ ok: false, code: 'audit_failed', status: 500, message: `No se pudo registrar la solicitud (${requested.error.message}). No se hizo ningún cambio` })

  // 2) Decisión sobre cada intento interrumpido: se registran como NO CONFIRMADOS. Nunca se reenvían solos.
  if (decisions.length > 0) {
    const events = await admin.from('crm_email_events').insert(decisions.map(d => ({
      lead_id: d.leadId,
      resend_email_id: null,
      event_type: 'email.send_unconfirmed',
      subject: null,
      raw_payload: { source: 'bulk-send-resume', job_id: req.jobId, resolution: d.resolution, claimed_at: d.claimedAt, evidence: d.evidence, resumed_by: req.userId, resumed_at: now.toISOString() },
    })))
    if (events.error) return abort({ ok: false, code: 'incomplete', status: 500, message: `No se pudieron registrar todas las decisiones (${events.error.message}). Reintenta: lo ya registrado no se duplica` })
    const activities = await admin.from('crm_lead_activities').insert(decisions.map(d => ({
      lead_id: d.leadId,
      action_type: 'note',
      description: d.resolution === 'provider_activity_seen'
        ? `Reanudación del job ${req.jobId}: intento interrumpido. Resend registró actividad para este destinatario después de la reserva; se da por posiblemente enviado y NO se reenvía. Revisar en Resend.`
        : `Reanudación del job ${req.jobId}: intento interrumpido sin evidencia del proveedor. NO se reenvía automáticamente; requiere revisión manual en Resend.`,
      created_by: req.userId,
    })))
    if (activities.error) return abort({ ok: false, code: 'incomplete', status: 500, message: `No se pudo registrar el historial (${activities.error.message}). Reintenta: lo ya registrado no se duplica` })
  }

  // 3) Resultado de la operación en la auditoría (si falla, la operación ya está hecha: se avisa, no se oculta).
  const completed = await admin.from('audit_logs').insert({
    ...auditBase, action: 'crm.bulk_job.resume_completed',
    changes: { at: now.toISOString(), decisions: decisions.map(d => ({ lead_id: d.leadId, resolution: d.resolution, evidence_events: d.evidence.length })), retried_automatically: 0 },
  })

  // 4) Se libera el bloqueo SIN avanzar el cursor: el procesador seguirá desde donde estaba.
  const released = await release()
  if (!released.held) return { ok: false, code: 'lease_lost', status: 409, message: 'Se perdió el bloqueo del job al terminar. Revisa su estado antes de continuar' }

  const finalReport = await inspectJob(admin, req.jobId, { now })
  return {
    ok: true,
    decisions,
    report: finalReport.ok ? finalReport.report : second.report,
    ...(completed.error ? { auditWarning: `La decisión se aplicó pero no se pudo registrar el resultado en la auditoría (${completed.error.message})` } : {}),
  }
}
