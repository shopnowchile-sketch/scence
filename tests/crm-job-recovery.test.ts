// Recuperación de un envío masivo que ya no se puede reanudar (job 2cc04ae7): job NUEVO solo con pendientes verificados.
// Base en memoria; no envía correos ni toca Supabase.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { makeAdmin, type Db } from './support/memory-supabase.ts'
import { planJobRecovery, createRecoveryJob, inspectJob, processLeadBatch, type BatchLead } from '../src/lib/crm-send-guard.ts'

const NOW = new Date('2026-11-12T12:00:00.000Z')
const TEMPLATE = 'crm_brand_presentation'
const lead = (id: string, over: Record<string, unknown> = {}) => ({ id, contact_name: 'Ana', company_name: 'ACME', email: `${id}@x.invalid`, qualification_status: 'unqualified', contacted_at: null as string | null, ...over })

// 10 contactos; los 4 primeros ya se procesaron (cursor 4). Pendientes: p0..p5 (índices 4..9).
function seed() {
  const ids = ['d0', 'd1', 'd2', 'd3', 'p-ok1', 'p-ok2', 'p-deleted', 'p-noemail', 'p-received', 'p-uncertain']
  const leads = ids.filter(i => i !== 'p-deleted').map(i => lead(i, i === 'p-noemail' ? { email: null } : {}))
  const job = {
    id: 'job-old', status: 'processing', cursor: 4, total: 10, sent: 3, skipped: 0, failed: 0, error: null,
    created_at: '2026-11-11T16:01:50.000Z', updated_at: '2026-11-11T19:57:00.000Z', lead_ids: ids, created_by: 'u0',
    template_key: TEMPLATE, subject: 'Hola', message: 'Mensaje', attachment_path: null, attachment_name: null,
  }
  const db: Db = {
    crm_leads: leads, crm_bulk_send_jobs: [job], audit_logs: [], crm_lead_activities: [],
    crm_email_events: [
      { lead_id: 'p-received', event_type: 'email.sent', raw_payload: { job_id: 'otro', template_key: TEMPLATE } },
      { lead_id: 'p-uncertain', event_type: 'email.send_unconfirmed', raw_payload: { job_id: 'otro', template_key: TEMPLATE } },
    ],
  }
  return db
}
const admin = (db: Db) => makeAdmin(db, { autoId: true })

describe('plan de recuperación', () => {
  test('solo quedan los pendientes verificados y cada exclusión se explica', async () => {
    const db = seed()
    const r = await planJobRecovery(admin(db), 'job-old')
    assert.ok(r.ok)
    assert.deepEqual(r.plan.eligible, ['p-ok1', 'p-ok2'])
    assert.equal(r.plan.pending, 6)
    assert.deepEqual(r.plan.excluded, { deleted: 1, noEmail: 1, alreadyReceived: 1, uncertain: 1, reservedWithoutResult: 0 })
  })

  test('un correo de otra plantilla no excluye; uno sin plantilla identificable sí (revisión manual)', async () => {
    const db = seed()
    db.crm_email_events.push({ lead_id: 'p-ok1', event_type: 'email.sent', raw_payload: { job_id: 'x', template_key: 'crm_intro' } })
    db.crm_email_events.push({ lead_id: 'p-ok2', event_type: 'email.sent', raw_payload: { source: 'bulk-send' } })
    const r = await planJobRecovery(admin(db), 'job-old')
    assert.ok(r.ok)
    assert.deepEqual(r.plan.eligible, ['p-ok1'])
    assert.equal(r.plan.excluded.uncertain, 2)
  })

  test('un lead reservado desde que arrancó el job sin resultado no se reenvía', async () => {
    const db = seed()
    db.crm_leads.find(l => l.id === 'p-ok2')!.contacted_at = '2026-11-11T18:00:00.000Z'
    const r = await planJobRecovery(admin(db), 'job-old')
    assert.ok(r.ok)
    assert.deepEqual(r.plan.eligible, ['p-ok1'])
    assert.equal(r.plan.excluded.reservedWithoutResult, 1)
  })

  test('si una consulta falla se detiene y no inventa una lista', async () => {
    const db = seed()
    const r = await planJobRecovery(makeAdmin(db, { autoId: true, failSelectOn: 'crm_email_events' }), 'job-old')
    assert.equal(r.ok, false)
  })

  test('un job completado no se recupera', async () => {
    const db = seed(); db.crm_bulk_send_jobs[0].status = 'completed'
    const r = await planJobRecovery(admin(db), 'job-old')
    assert.equal(r.ok, false)
  })
})

describe('creación del job de recuperación', () => {
  const req = (over: Record<string, unknown> = {}) => ({ jobId: 'job-old', userId: 'u1', userEmail: 'a@x.invalid', confirm: true, expectedEligible: 2, ...over })

  test('crea un job NUEVO pending, reanudable, sin tocar el original ni enviar nada', async () => {
    const db = seed()
    const before = JSON.stringify(db.crm_bulk_send_jobs[0])
    const r = await createRecoveryJob(admin(db), req())
    assert.ok(r.ok)
    assert.equal(JSON.stringify(db.crm_bulk_send_jobs[0]), before, 'el job original queda intacto')
    const fresh = db.crm_bulk_send_jobs.find(j => j.id === r.newJobId)!
    assert.deepEqual([fresh.status, fresh.total, fresh.cursor ?? 0, fresh.template_key, fresh.subject], ['pending', 2, 0, TEMPLATE, 'Hola'])
    assert.deepEqual(fresh.lead_ids, ['p-ok1', 'p-ok2'])
    assert.equal(db.crm_email_events.filter(e => e.event_type === 'email.sent').length, 1, 'no se registra ningún envío nuevo')
    assert.ok(db.audit_logs.some(a => a.action === 'crm.bulk_job.recovered' && a.entity_id === 'job-old' && a.changes.new_job_id === r.newJobId))
    // El job nuevo pasa las comprobaciones de reanudación (contadores, edad, bloqueo).
    const fresh2 = { cursor: 0, sent: 0, skipped: 0, failed: 0, error: null, created_at: NOW.toISOString(), updated_at: NOW.toISOString() }
    Object.assign(fresh, fresh2)
    const insp = await inspectJob(admin(db), r.newJobId, { now: NOW })
    assert.ok(insp.ok && insp.report.resumable, JSON.stringify(insp.ok ? insp.report.blockers : insp))
  })

  test('exige confirmación y que el número revisado coincida', async () => {
    const db = seed()
    assert.equal((await createRecoveryJob(admin(db), req({ confirm: false }))).ok, false)
    const stale = await createRecoveryJob(admin(db), req({ expectedEligible: 5 }))
    assert.ok(!stale.ok && stale.status === 409)
    assert.equal(db.crm_bulk_send_jobs.length, 1)
  })

  test('no se crea dos veces: el segundo intento devuelve el job ya creado', async () => {
    const db = seed()
    const first = await createRecoveryJob(admin(db), req())
    assert.ok(first.ok)
    const second = await createRecoveryJob(admin(db), req())
    assert.ok(!second.ok && second.status === 409 && second.newJobId === first.newJobId)
    assert.equal(db.crm_bulk_send_jobs.length, 2)
  })

  test('el envío posterior sigue sin duplicar: quien recibió la plantilla entre medias se omite', async () => {
    const db = seed()
    const r = await createRecoveryJob(admin(db), req())
    assert.ok(r.ok)
    // Entre la creación y el envío, p-ok1 recibe la plantilla por otro camino.
    db.crm_email_events.push({ lead_id: 'p-ok1', event_type: 'email.sent', raw_payload: { job_id: 'otro', template_key: TEMPLATE } })
    const sentTo: string[] = []
    const leads = db.crm_leads.filter(l => ['p-ok1', 'p-ok2'].includes(l.id)) as BatchLead[]
    const res = await processLeadBatch(admin(db), { jobId: r.newJobId, userId: 'u1', leads, templateKey: TEMPLATE, jobCreatedAt: NOW.toISOString() }, {
      isBlocked: () => false, pause: async () => {},
      prepare: l => ({ subject: 's', message: 'm', templateKey: TEMPLATE, templateName: 'P', send: async () => { sentTo.push(l.id); return { id: 're_1', error: null } } }),
    })
    assert.deepEqual(sentTo, ['p-ok2'])
    assert.deepEqual([res.sent, res.skipped, res.alreadySentTemplate], [1, 1, 1])
  })
})

describe('causa del descuadre del cursor', () => {
  test('la tanda cuenta como omitidos los contactos borrados del CRM (cursor = enviados + omitidos + fallidos)', () => {
    const src = readFileSync('src/app/api/crm-leads/bulk-send/process/route.ts', 'utf8')
    assert.match(src, /missingLeads = batchIds\.length - \(leads\?\.length \?\? 0\)/)
    assert.match(src, /skipped = skippedInBatch \+ missingLeads/)
    assert.match(src, /skipped: current\.skipped \+ skipped/)
  })
  test('la ruta de recuperación es solo para admins del CRM y no dispara el procesador', () => {
    const src = readFileSync('src/app/api/crm-leads/bulk-send/jobs/[jobId]/recover/route.ts', 'utf8')
    assert.match(src, /isCrmAdmin/)
    assert.doesNotMatch(src, /waitUntil|bulk-send\/process|resend/i)
  })
})
