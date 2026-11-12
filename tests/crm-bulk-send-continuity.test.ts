// Regresiones del envío masivo CRM: continuidad de la cadena, barrera de inactivas, duplicados y KPI.
// Base en memoria; el proveedor es una función simulada. No envía correos ni toca Supabase.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { processLeadBatch, type BatchDeps, type BatchLead, type OutgoingEmail } from '../src/lib/crm-send-guard.ts'
import { makeAdmin, type Db } from './support/memory-supabase.ts'

const lead = (id: string, over: Partial<BatchLead> = {}): BatchLead =>
  ({ id, contact_name: 'Ana', company_name: 'ACME', email: `${id}@x.cl`, qualification_status: 'unqualified', contacted_at: null, ...over })
const freshDb = (leads: BatchLead[]): Db =>
  ({ crm_leads: leads.map(l => ({ ...l })), crm_email_events: [], crm_lead_activities: [], crm_bulk_send_jobs: [] })
const deps = (send: OutgoingEmail['send']): BatchDeps => ({
  isBlocked: () => false,
  pause: async () => {},
  prepare: l => ({ subject: `Hola ${l.id}`, message: 'm', templateKey: 'crm_intro', templateName: 'Intro', send }),
})

describe('barrera de influencers inactivas dentro del envío masivo', () => {
  test('si getResend retira al destinatario (sin id ni error): no es un envío, no suma a KPI y libera la reserva', async () => {
    const leads = [lead('a', { contacted_at: '2026-09-01T00:00:00.000Z' })]
    const db = freshDb(leads)
    // Mismo resultado que devuelve getResend() cuando la barrera quita el destinatario: { data: null, error: null }
    const r = await processLeadBatch(makeAdmin(db), { jobId: 'J', userId: 'u', leads }, deps(async () => ({ id: null, error: null })))
    assert.deepEqual([r.sent, r.skipped, r.failed, r.blockedByGuard], [0, 1, 0, 1])
    assert.equal(db.crm_email_events.length, 0, 'no se registra email.sent')
    assert.equal(db.crm_leads[0].contacted_at, '2026-09-01T00:00:00.000Z', 'contacted_at vuelve a su valor')
    assert.equal(db.crm_leads[0].qualification_status, 'unqualified', 'el lead no pasa a contactado')
    assert.ok(db.crm_lead_activities.some(a => String(a.description).includes('influencer inactiva')))
  })

  test('un envío normal (con id) sigue contando como enviado', async () => {
    const leads = [lead('a')]
    const db = freshDb(leads)
    const r = await processLeadBatch(makeAdmin(db), { jobId: 'J', userId: 'u', leads }, deps(async () => ({ id: 'r1', error: null })))
    assert.deepEqual([r.sent, r.blockedByGuard], [1, 0])
    assert.equal(db.crm_email_events[0].event_type, 'email.sent')
  })

  test('la audiencia crm ya no se "confirma" con crm_leads (siempre daba verdadero)', () => {
    const src = readFileSync('src/lib/inactive-influencer-email-guard.ts', 'utf8')
    assert.doesNotMatch(src, /audience === 'crm'\)\s*\{\s*count\(admin\.from\('crm_leads'\)/)
    assert.doesNotMatch(src, /from\('crm_leads'\)/)
  })
})

describe('duplicados entre jobs', () => {
  const withTemplate = { jobId: 'J2', userId: 'u', templateKey: 'crm_intro' }

  test('un lead que ya recibió la misma plantilla en otro job no se vuelve a enviar', async () => {
    const leads = [lead('a'), lead('b')]
    const db = freshDb(leads)
    db.crm_email_events.push({ lead_id: 'a', event_type: 'email.sent', raw_payload: { job_id: 'J1', template_key: 'crm_intro' } })
    const sentTo: string[] = []
    const r = await processLeadBatch(makeAdmin(db), { ...withTemplate, leads }, {
      isBlocked: () => false, pause: async () => {},
      prepare: l => ({ subject: 's', message: 'm', templateKey: 'crm_intro', templateName: 'Intro', send: async () => { sentTo.push(l.id); return { id: 'x', error: null } } }),
    })
    assert.deepEqual(sentTo, ['b'])
    assert.deepEqual([r.sent, r.skipped, r.alreadySentTemplate], [1, 1, 1])
  })

  test('otra plantilla (seguimiento) sí se envía al mismo lead', async () => {
    const leads = [lead('a')]
    const db = freshDb(leads)
    db.crm_email_events.push({ lead_id: 'a', event_type: 'email.sent', raw_payload: { job_id: 'J1', template_key: 'crm_intro' } })
    const r = await processLeadBatch(makeAdmin(db), { ...withTemplate, templateKey: 'crm_follow_up', leads }, deps(async () => ({ id: 'x', error: null })))
    assert.equal(r.sent, 1)
  })

  test('un envío no confirmado no cuenta como plantilla recibida (se revisa a mano, no se reenvía por otra vía)', async () => {
    const leads = [lead('a')]
    const db = freshDb(leads)
    db.crm_email_events.push({ lead_id: 'a', event_type: 'email.failed', raw_payload: { job_id: 'J1', template_key: 'crm_intro' } })
    const r = await processLeadBatch(makeAdmin(db), { ...withTemplate, leads }, deps(async () => ({ id: 'x', error: null })))
    assert.equal(r.sent, 1)
  })
})

describe('cadena del job (process/route.ts)', () => {
  const src = readFileSync('src/app/api/crm-leads/bulk-send/process/route.ts', 'utf8')

  test('procesa varias tandas por invocación: hay bucle con presupuesto de tiempo', () => {
    assert.match(src, /LOOP_BUDGET_MS/)
    assert.match(src, /for \(let batchNumber = 1; ; batchNumber\+\+\)/)
    assert.match(src, /Date\.now\(\) - startedAt < LOOP_BUDGET_MS/)
  })

  test('solo se encadena (fetch a sí mismo) cuando el presupuesto se agotó, una vez y fuera del bucle de tandas', () => {
    assert.equal((src.match(/waitUntil\(/g) ?? []).length, 1)
    assert.ok(src.indexOf('claimJobBatch(admin, updated)') < src.indexOf('waitUntil('), 'primero intenta seguir en la misma invocación')
  })

  test('mantiene los frenos: lease por tanda, fallo cerrado y no encadena si perdió el lease', () => {
    assert.match(src, /claimJobBatch\(admin, job\)/)
    assert.match(src, /failJobBatch\(admin, jobId, marker/)
    assert.match(src, /lease perdido al guardar el avance — no se encadena/)
    assert.match(src, /if \(!next\.ok\)/)
  })

  test('el email de resumen y el cierre del job no cambian', () => {
    assert.match(src, /status: isDone \? 'completed' : 'processing'/)
    assert.match(src, /Envío masivo CRM terminado/)
  })
})

describe('envío individual (send-intro)', () => {
  test('si la barrera retira al destinatario no se registra como enviado y se libera la reserva', () => {
    const src = readFileSync('src/app/api/crm-leads/[id]/send-intro/route.ts', 'utf8')
    const guardIndex = src.indexOf('if (!emailData?.id)')
    assert.ok(guardIndex > 0)
    assert.ok(guardIndex < src.indexOf("event_type: 'email.sent'"), 'el control va antes de registrar email.sent')
    assert.match(src.slice(guardIndex, guardIndex + 600), /releaseLeadSend/)
  })
})
