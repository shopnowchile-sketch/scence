// Reanudación MANUAL de jobs de envío masivo: interrupción, concurrencia, recuperación y duplicación.
// Base en memoria (tests/support/memory-supabase.ts). NO envía correos: el proveedor es una función simulada.
// NO toca Supabase ni producción.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { makeAdmin, type Db } from './support/memory-supabase.ts'
import {
  inspectJob, resumeJob, processLeadBatch, claimLeadSend, buildLeaseMarker, BATCH_SIZE, JOB_LEASE_MS,
  type BatchDeps, type BatchLead,
} from '../src/lib/crm-send-guard.ts'

const NOW = new Date('2026-10-10T12:00:00.000Z')
const iso = (minutesFromNow: number) => new Date(NOW.getTime() + minutesFromNow * 60_000).toISOString()
const USER = 'admin-user-1'

function seed(over: { jobs?: Record<string, unknown>; leads?: number } = {}) {
  const n = over.leads ?? 10
  const leads = Array.from({ length: n }, (_, i) => ({
    id: `lead-${i}`, contact_name: 'Ana', company_name: 'ACME', email: `l${i}@x.invalid`, qualification_status: 'unqualified', contacted_at: null as string | null,
  }))
  const job = {
    id: 'job-1', status: 'processing', cursor: 0, total: n, sent: 0, skipped: 0, failed: 0, error: null as string | null,
    created_at: iso(-60), updated_at: iso(-50), lead_ids: leads.map(l => l.id), created_by: USER, ...over.jobs,
  }
  const db: Db = { crm_leads: leads, crm_bulk_send_jobs: [job], crm_email_events: [], crm_lead_activities: [], audit_logs: [] }
  return { db, leads, job }
}

const snapshot = (db: Db) => JSON.stringify({ e: db.crm_email_events, a: db.crm_lead_activities, l: db.audit_logs, j: db.crm_bulk_send_jobs })
const fingerprintOf = async (db: Db, opts = {}) => { const r = await inspectJob(makeAdmin(db, opts), 'job-1', { now: NOW }); assert.ok(r.ok); return (r as any).report.fingerprint as string }
const resume = (db: Db, fingerprint: string, extra: Record<string, unknown> = {}, opts = {}) =>
  resumeJob(makeAdmin(db, opts), { jobId: 'job-1', userId: USER, confirm: true, expectedFingerprint: fingerprint, now: NOW, ...extra })

function claimed(db: Db, ...ids: string[]) { for (const l of db.crm_leads) if (ids.includes(l.id)) l.contacted_at = iso(-30) }
function webhookEvent(db: Db, leadId: string, minutesFromNow: number, type = 'email.delivered') {
  db.crm_email_events.push({ id: `wh-${db.crm_email_events.length}`, lead_id: leadId, event_type: type, created_at: iso(minutesFromNow), raw_payload: { type, data: { email_id: 're_x', to: ['x@x.invalid'] } } })
}

describe('reanudación: lo que NUNCA debe hacer', () => {
  test('no reabre jobs cerrados, incluidos los antiguos como los 20 de septiembre', async () => {
    for (const status of ['failed', 'completed']) {
      const { db } = seed({ jobs: { status, created_at: '2026-09-09T21:03:39.251Z', updated_at: '2026-09-09T21:05:19.026Z', error: 'Cerrado manualmente tras auditoría 2026-10-09' } })
      const before = snapshot(db)
      const insp = await inspectJob(makeAdmin(db), 'job-1', { now: NOW })
      assert.ok(insp.ok)
      assert.equal((insp as any).report.resumable, false)
      const codes = (insp as any).report.blockers.map((b: any) => b.code)
      assert.ok(codes.includes('closed') && codes.includes('too_old'))
      const r = await resume(db, 'cualquiera')
      assert.equal(r.ok, false)
      assert.equal(snapshot(db), before, 'no escribe nada')
    }
  })

  test('no reanuda un job abierto de más de 12 horas', async () => {
    const { db } = seed({ jobs: { created_at: iso(-13 * 60) } })
    const before = snapshot(db)
    const r = await resume(db, 'x')
    assert.equal(r.ok, false)
    assert.ok((r as any).blockers.some((b: any) => b.code === 'too_old'))
    assert.equal(snapshot(db), before)
  })

  test('sin confirmación explícita no hace nada', async () => {
    const { db } = seed()
    const fp = await fingerprintOf(db)
    const before = snapshot(db)
    const r = await resumeJob(makeAdmin(db), { jobId: 'job-1', userId: USER, confirm: false, expectedFingerprint: fp, now: NOW })
    assert.deepEqual([r.ok, (r as any).code], [false, 'confirm_required'])
    assert.equal(snapshot(db), before)
  })

  test('con otro proceso trabajando (bloqueo vigente) responde busy sin escribir', async () => {
    const { db } = seed({ jobs: { error: buildLeaseMarker('otro', new Date(NOW.getTime() + 60_000)) } })
    const before = snapshot(db)
    const r = await resume(db, 'x')
    assert.deepEqual([r.ok, (r as any).code], [false, 'busy'])
    assert.equal(snapshot(db), before)
  })

  test('si el estado cambió desde que se consultó (huella distinta) se rechaza', async () => {
    const { db } = seed()
    claimed(db, 'lead-1')
    const before = snapshot(db)
    const r = await resume(db, 'huella-vieja')
    assert.deepEqual([r.ok, (r as any).code], [false, 'stale_state'])
    assert.equal(snapshot(db), before)
  })
})

describe('reanudación: se detiene y pide revisión manual cuando no puede determinar qué se envió', () => {
  test('contadores que no cuadran con el cursor', async () => {
    const { db } = seed({ jobs: { cursor: 50, total: 200, sent: 10, skipped: 0, failed: 0, lead_ids: Array.from({ length: 200 }, (_, i) => `lead-${i}`) } })
    const insp = (await inspectJob(makeAdmin(db), 'job-1', { now: NOW })) as any
    assert.equal(insp.report.resumable, false)
    assert.ok(insp.report.blockers.some((b: any) => b.code === 'manual_review' && /contadores/.test(b.message)))
    const before = snapshot(db)
    assert.equal((await resume(db, insp.report.fingerprint)).ok, false)
    assert.equal(snapshot(db), before)
  })

  test('no se puede consultar el registro de eventos (falla cerrado)', async () => {
    const { db } = seed()
    const insp = (await inspectJob(makeAdmin(db, { failSelectOn: 'crm_email_events' }), 'job-1', { now: NOW })) as any
    assert.equal(insp.report.resumable, false)
    assert.ok(insp.report.blockers.some((b: any) => b.code === 'manual_review'))
  })

  test('mensaje de error previo inesperado en un job abierto', async () => {
    const { db } = seed({ jobs: { error: 'algo raro' } })
    const insp = (await inspectJob(makeAdmin(db), 'job-1', { now: NOW })) as any
    assert.ok(insp.report.blockers.some((b: any) => b.code === 'manual_review'))
  })
})

describe('reanudación: qué hace cuando es segura', () => {
  test('sin intentos interrumpidos: registra quién y cuándo, no avanza el cursor y libera el bloqueo', async () => {
    const { db } = seed()
    const fp = await fingerprintOf(db)
    const jobBefore = JSON.stringify({ ...db.crm_bulk_send_jobs[0], error: null, updated_at: null })
    const r = await resume(db, fp)
    assert.equal(r.ok, true)
    assert.equal((r as any).decisions.length, 0)
    const job = db.crm_bulk_send_jobs[0]
    assert.equal(job.error, null, 'el bloqueo se libera')
    assert.equal(job.cursor, 0, 'NO avanza el cursor')
    assert.equal(job.status, 'processing')
    assert.equal(JSON.stringify({ ...job, error: null, updated_at: null }), jobBefore, 'contadores y lista de leads intactos')
    const audit = db.audit_logs.map(a => a.action)
    assert.deepEqual(audit, ['crm.bulk_job.resume_requested', 'crm.bulk_job.resume_completed'])
    assert.ok(db.audit_logs.every(a => a.actor_id === USER && a.entity_id === 'job-1' && a.entity_type === 'crm_bulk_send_job'))
    assert.equal(db.audit_logs[1].changes.at, NOW.toISOString())
    assert.equal(db.audit_logs[1].changes.retried_automatically, 0)
  })

  test('también reanuda un job pendiente que nunca arrancó', async () => {
    const { db } = seed({ jobs: { status: 'pending' } })
    assert.equal((await resume(db, await fingerprintOf(db))).ok, true)
  })

  test('intentos interrumpidos SIN evidencia: se registran como no confirmados y NO se reenvían', async () => {
    const { db } = seed()
    claimed(db, 'lead-0', 'lead-1', 'lead-2')
    const fp = await fingerprintOf(db)
    const r = (await resume(db, fp)) as any
    assert.equal(r.ok, true)
    assert.equal(r.decisions.length, 3)
    assert.ok(r.decisions.every((d: any) => d.resolution === 'no_provider_evidence'))
    const unconfirmed = db.crm_email_events.filter(e => e.event_type === 'email.send_unconfirmed')
    assert.equal(unconfirmed.length, 3)
    assert.ok(unconfirmed.every(e => e.raw_payload.job_id === 'job-1' && e.raw_payload.source === 'bulk-send-resume' && e.raw_payload.resumed_by === USER && e.raw_payload.resolution === 'no_provider_evidence'))
    assert.equal(db.crm_lead_activities.length, 3)
    assert.ok(db.crm_lead_activities.every(a => a.created_by === USER && /NO se reenvía/.test(a.description)))
    assert.equal(db.audit_logs[1].changes.decisions.length, 3)

    // Después, el procesador continúa: los 3 NO reciben nada y los demás sí, una sola vez.
    const sentTo: string[] = []
    const deps: BatchDeps = { isBlocked: () => false, pause: async () => {}, prepare: l => ({ subject: 's', message: 'm', templateKey: 'k', templateName: 'n', send: async () => { sentTo.push(l.id); return { id: 'x', error: null } } }) }
    const leads = db.crm_leads.map(l => ({ ...l })) as BatchLead[]
    const batch = await processLeadBatch(makeAdmin(db), { jobId: 'job-1', userId: USER, leads }, deps)
    assert.deepEqual(sentTo.sort(), ['lead-3', 'lead-4', 'lead-5', 'lead-6', 'lead-7', 'lead-8', 'lead-9'])
    assert.equal(batch.alreadyHandled, 3)
  })

  test('con actividad del proveedor tras la reserva: se distingue, pero igual NO se reenvía', async () => {
    const { db } = seed()
    claimed(db, 'lead-0', 'lead-1')
    webhookEvent(db, 'lead-0', -20)                // webhook de Resend DESPUÉS de la reserva (−30 min)
    webhookEvent(db, 'lead-1', -45)                // ANTES de la reserva: no cuenta
    db.crm_email_events.push({ id: 'own', lead_id: 'lead-1', event_type: 'email.sent', created_at: iso(-10), raw_payload: { source: 'send-intro' } }) // evento propio: no cuenta
    const r = (await resume(db, await fingerprintOf(db))) as any
    assert.equal(r.ok, true)
    const byLead = Object.fromEntries(r.decisions.map((d: any) => [d.leadId, d]))
    assert.equal(byLead['lead-0'].resolution, 'provider_activity_seen')
    assert.equal(byLead['lead-0'].evidence.length, 1)
    assert.equal(byLead['lead-1'].resolution, 'no_provider_evidence')
    assert.equal(db.crm_email_events.filter(e => e.event_type === 'email.send_unconfirmed').length, 2)
  })

  test('idempotente: reanudar dos veces no duplica decisiones', async () => {
    const { db } = seed()
    claimed(db, 'lead-0', 'lead-1')
    assert.equal(((await resume(db, await fingerprintOf(db))) as any).decisions.length, 2)
    const eventsAfterFirst = db.crm_email_events.length
    const second = (await resume(db, await fingerprintOf(db))) as any
    assert.equal(second.ok, true)
    assert.equal(second.decisions.length, 0)
    assert.equal(db.crm_email_events.length, eventsAfterFirst)
    assert.equal(db.crm_lead_activities.length, 2)
    assert.equal(db.audit_logs.length, 4, 'cada solicitud queda auditada, también la repetida')
  })

  test('concurrencia: dos administradores reanudan a la vez, solo uno ejecuta y no hay decisiones duplicadas', async () => {
    const { db } = seed()
    claimed(db, 'lead-0', 'lead-1', 'lead-2')
    const fp = await fingerprintOf(db)
    const results = await Promise.all([resume(db, fp, { userId: 'admin-A', token: 'A' }), resume(db, fp, { userId: 'admin-B', token: 'B' })])
    assert.equal(results.filter(r => r.ok).length, 1)
    assert.equal(results.filter(r => !r.ok).length, 1)
    assert.equal(db.crm_email_events.filter(e => e.event_type === 'email.send_unconfirmed').length, 3)
    assert.equal(db.crm_lead_activities.length, 3)
    assert.equal(db.crm_bulk_send_jobs[0].error, null, 'el bloqueo queda liberado')
  })
})

describe('reanudación: fallos durante la operación', () => {
  test('si no se puede registrar la auditoría, NO se cambia nada y se libera el bloqueo', async () => {
    const { db } = seed()
    claimed(db, 'lead-0')
    const fp = await fingerprintOf(db)
    const r = await resume(db, fp, {}, { failInsertOn: 'audit_logs' })
    assert.deepEqual([r.ok, (r as any).code], [false, 'audit_failed'])
    assert.equal(db.crm_email_events.length, 0)
    assert.equal(db.crm_lead_activities.length, 0)
    assert.equal(db.crm_bulk_send_jobs[0].error, null)
  })

  test('si falla el registro de decisiones: "incomplete", bloqueo liberado y sin procesar', async () => {
    const { db } = seed()
    claimed(db, 'lead-0')
    const fp = await fingerprintOf(db)
    const r = await resume(db, fp, {}, { failInsertOn: 'crm_email_events' })
    assert.deepEqual([r.ok, (r as any).code], [false, 'incomplete'])
    assert.equal(db.crm_bulk_send_jobs[0].error, null)
    assert.equal(db.crm_bulk_send_jobs[0].cursor, 0)
  })
})

describe('escenario completo: interrupción real → reanudación → recuperación sin duplicar', () => {
  test('una tanda muere a la mitad; tras reanudar, ningún lead recibe dos correos', async () => {
    const { db } = seed({ leads: 10 })
    const sentTo: string[] = []
    const deps: BatchDeps = { isBlocked: () => false, pause: async () => {}, prepare: l => ({ subject: 's', message: 'm', templateKey: 'k', templateName: 'n', send: async () => { sentTo.push(l.id); return { id: `re_${l.id}`, error: null } } }) }

    // La función procesa los leads 0-3 completos y MUERE justo después de reservar 4 y 5 (antes de llamar al proveedor).
    const first4 = db.crm_leads.slice(0, 4).map(l => ({ ...l })) as BatchLead[]
    await processLeadBatch(makeAdmin(db), { jobId: 'job-1', userId: USER, leads: first4 }, deps)
    for (const id of ['lead-4', 'lead-5']) await claimLeadSend(makeAdmin(db), id, null, new Date(NOW.getTime() - 5 * 60_000))
    assert.equal(sentTo.length, 4)
    // El cursor y los contadores del job NO se actualizaron (la función murió antes). El bloqueo quedó vencido.
    db.crm_bulk_send_jobs[0].error = buildLeaseMarker('muerto', new Date(NOW.getTime() - JOB_LEASE_MS))
    db.crm_leads.forEach(l => { if (l.contacted_at) l.contacted_at = iso(-30) })

    const insp = (await inspectJob(makeAdmin(db), 'job-1', { now: NOW })) as any
    assert.equal(insp.report.resumable, true)
    assert.equal(insp.report.counts.confirmed, 4)
    assert.deepEqual(insp.report.interrupted.map((i: any) => i.leadId).sort(), ['lead-4', 'lead-5'])

    const r = (await resume(db, insp.report.fingerprint)) as any
    assert.equal(r.ok, true)

    // El procesador retoma la MISMA tanda desde el cursor 0.
    const leads = db.crm_leads.map(l => ({ ...l })) as BatchLead[]
    await processLeadBatch(makeAdmin(db), { jobId: 'job-1', userId: USER, leads }, deps)
    const counts = sentTo.reduce<Record<string, number>>((acc, id) => ({ ...acc, [id]: (acc[id] ?? 0) + 1 }), {})
    assert.ok(Object.values(counts).every(n => n === 1), `ningún lead debe recibir dos correos: ${JSON.stringify(counts)}`)
    assert.equal(sentTo.length, 8, 'leads 0-3 una vez, 6-9 una vez; 4 y 5 quedan para revisión manual')
    assert.ok(!sentTo.includes('lead-4') && !sentTo.includes('lead-5'))
  })
})
