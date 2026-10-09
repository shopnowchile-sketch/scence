// PRUEBA DE INTEGRACIÓN — concurrencia REAL contra una base de Supabase DE PRUEBAS.
// NO la ejecuta `npm test` (carpeta y sufijo distintos). NO envía correos (el envío es simulado).
// NUNCA contra producción: se niega a correr si la URL contiene el proyecto de producción.
//
//   CRM_IT_ALLOW=yes CRM_IT_SUPABASE_URL=https://<rama>.supabase.co CRM_IT_SERVICE_KEY=<service role de LA RAMA> \
//     node --test tests/integration/crm-concurrency.integration.ts
//
// Requiere en la base de pruebas las tablas: crm_leads, crm_lead_activities, crm_email_events,
// crm_bulk_send_jobs y profiles (ver docs/proposals/crm_test_environment_and_job_resume.md).
// Todos los datos son sintéticos (source='it_synthetic', *.invalid) y se eliminan al terminar.
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import {
  claimLeadSend, claimJobBatch, processLeadBatch, buildLeaseMarker, JOB_LEASE_MS, inspectJob, resumeJob,
  type BatchDeps, type BatchLead,
} from '../../src/lib/crm-send-guard.ts'

const PRODUCTION_PROJECT_REF = 'xzzbishzfyovrladcaeb'
const url = process.env.CRM_IT_SUPABASE_URL
const key = process.env.CRM_IT_SERVICE_KEY
const enabled = process.env.CRM_IT_ALLOW === 'yes' && Boolean(url) && Boolean(key)

if (enabled && url!.includes(PRODUCTION_PROJECT_REF)) {
  throw new Error('RECHAZADO: la URL apunta al proyecto de PRODUCCIÓN. Esta prueba solo corre contra una base de pruebas.')
}

const SOURCE = 'it_synthetic'
const T0 = new Date()

describe('CRM: concurrencia real contra Supabase de pruebas', { skip: enabled ? false : 'omitida: faltan CRM_IT_ALLOW=yes, CRM_IT_SUPABASE_URL o CRM_IT_SERVICE_KEY' }, () => {
  let admin: any
  let userId: string
  const jobIds: string[] = []

  async function makeLeads(n: number): Promise<BatchLead[]> {
    const rows = Array.from({ length: n }, (_, i) => ({
      source: SOURCE, company_name: `Empresa sintética ${i}`, contact_name: 'Prueba',
      email: `it-${randomUUID()}@scence-test.invalid`, qualification_status: 'unqualified',
    }))
    const { data, error } = await admin.from('crm_leads').insert(rows).select('id, contact_name, company_name, email, qualification_status, contacted_at')
    assert.ifError(error)
    return data as BatchLead[]
  }

  async function makeJob(leadIds: string[], over: Record<string, unknown> = {}) {
    const { data, error } = await admin.from('crm_bulk_send_jobs').insert({
      created_by: userId, lead_ids: leadIds, subject: 'prueba', message: 'prueba', status: 'pending', cursor: 0,
      total: leadIds.length, template_key: 'crm_intro', ...over,
    }).select('*').single()
    assert.ifError(error)
    jobIds.push(data.id)
    return data
  }

  function countingDeps(sentTo: string[]): BatchDeps {
    return {
      isBlocked: () => false,
      pause: async () => {},
      prepare: lead => ({
        subject: 'prueba', message: 'prueba', templateKey: 'crm_intro', templateName: 'Intro',
        send: async () => { await new Promise(r => setTimeout(r, Math.random() * 20)); sentTo.push(lead.id); return { id: `sim-${randomUUID()}`, error: null } },
      }),
    }
  }

  before(async () => {
    admin = createClient(url!, key!, { auth: { persistSession: false } })
    const { data, error } = await admin.from('profiles').select('id').limit(1)
    assert.ifError(error)
    assert.ok(data?.length, 'la base de pruebas necesita al menos un perfil para created_by')
    userId = data[0].id
  })

  after(async () => {
    if (!admin) return
    if (jobIds.length) {
      await admin.from('audit_logs').delete().in('entity_id', jobIds)
      await admin.from('crm_bulk_send_jobs').delete().in('id', jobIds)
    }
    // El borrado de leads arrastra eventos y actividades (ON DELETE CASCADE).
    await admin.from('crm_leads').delete().eq('source', SOURCE)
  })

  test('1 · 20 reservas simultáneas del mismo lead: exactamente 1 gana', async () => {
    const [lead] = await makeLeads(1)
    const results = await Promise.all(Array.from({ length: 20 }, () => claimLeadSend(admin, lead.id, null)))
    assert.equal(results.filter(r => r.claimed).length, 1)
  })

  test('2 · dos tandas simultáneas sobre los mismos 25 leads: un envío por lead', async () => {
    const leads = await makeLeads(25)
    const jobId = randomUUID()
    const sentTo: string[] = []
    await Promise.all([
      processLeadBatch(admin, { jobId, userId, leads }, countingDeps(sentTo)),
      processLeadBatch(admin, { jobId: randomUUID(), userId, leads }, countingDeps(sentTo)),
    ])
    assert.equal(sentTo.length, 25)
    assert.equal(new Set(sentTo).size, 25)
    const { count } = await admin.from('crm_email_events').select('id', { count: 'exact', head: true }).in('lead_id', leads.map(l => l.id)).eq('event_type', 'email.sent')
    assert.equal(count, 25)

    // 5 · el ledger del job impide reenviar aunque la ventana de 10 min ya no proteja
    await admin.from('crm_leads').update({ contacted_at: '2026-01-01T00:00:00.000Z' }).in('id', leads.map(l => l.id))
    const refreshed = leads.map(l => ({ ...l, contacted_at: '2026-01-01T00:00:00.000Z' }))
    const again: string[] = []
    const r = await processLeadBatch(admin, { jobId, userId, leads: refreshed }, countingDeps(again))
    assert.ok(r.alreadyHandled > 0, 'el ledger debe reconocer los envíos del job')
    assert.ok(again.length < 25, 'no se debe reenviar a los ya tratados en este job')
  })

  test('3 · 10 invocaciones simultáneas del mismo job: exactamente 1 toma la tanda', async () => {
    const leads = await makeLeads(3)
    const job = await makeJob(leads.map(l => l.id))
    const results = await Promise.all(Array.from({ length: 10 }, () => claimJobBatch(admin, job)))
    assert.equal(results.filter(r => r.ok).length, 1)
    assert.equal(results.filter(r => !r.ok && r.reason === 'busy').length, 9)
  })

  test('4 · lease vencido: 5 invocaciones simultáneas, exactamente 1 lo toma', async () => {
    const leads = await makeLeads(2)
    const expired = buildLeaseMarker('muerto', new Date(Date.now() - JOB_LEASE_MS))
    const job = await makeJob(leads.map(l => l.id), { status: 'processing', error: expired })
    const results = await Promise.all(Array.from({ length: 5 }, () => claimJobBatch(admin, job)))
    assert.equal(results.filter(r => r.ok).length, 1)
  })

  // ── Reanudación manual (jobs SINTÉTICOS creados aquí; nunca los 20 de producción) ─────────────────
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()

  test('7 · reanudación: intentos interrumpidos quedan como no confirmados, auditados, y NO se reenvían', async () => {
    const leads = await makeLeads(6)
    const job = await makeJob(leads.map(l => l.id), { status: 'processing', created_at: minutesAgo(60) })
    // Tres leads quedaron reservados (la función murió antes de llamar al proveedor): contacted_at sin ningún evento.
    const interruptedIds = leads.slice(0, 3).map(l => l.id)
    await admin.from('crm_leads').update({ contacted_at: minutesAgo(30) }).in('id', interruptedIds)

    const insp: any = await inspectJob(admin, job.id)
    assert.ok(insp.ok && insp.report.resumable, JSON.stringify(insp.blockers ?? insp.report?.blockers))
    assert.deepEqual(insp.report.interrupted.map((i: any) => i.leadId).sort(), [...interruptedIds].sort())

    const r: any = await resumeJob(admin, { jobId: job.id, userId, confirm: true, expectedFingerprint: insp.report.fingerprint })
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.equal(r.decisions.length, 3)

    const { data: events } = await admin.from('crm_email_events').select('lead_id, event_type, raw_payload').eq('event_type', 'email.send_unconfirmed').in('lead_id', interruptedIds)
    assert.equal(events.length, 3)
    assert.ok(events.every((e: any) => e.raw_payload.job_id === job.id && e.raw_payload.resumed_by === userId))
    const { data: audit } = await admin.from('audit_logs').select('action, actor_id').eq('entity_id', job.id)
    assert.deepEqual((audit as any[]).map(a => a.action).sort(), ['crm.bulk_job.resume_completed', 'crm.bulk_job.resume_requested'])
    assert.ok((audit as any[]).every(a => a.actor_id === userId))
    const { data: after } = await admin.from('crm_bulk_send_jobs').select('error, cursor, status').eq('id', job.id).single()
    assert.deepEqual(after, { error: null, cursor: 0, status: 'processing' })

    // El procesador continúa con la MISMA tanda: solo se envía (simulado) a los 3 no interrumpidos.
    const sentTo: string[] = []
    const { data: fresh } = await admin.from('crm_leads').select('id, contact_name, company_name, email, qualification_status, contacted_at').in('id', leads.map(l => l.id))
    await processLeadBatch(admin, { jobId: job.id, userId, leads: fresh as BatchLead[] }, countingDeps(sentTo))
    assert.deepEqual(sentTo.sort(), leads.slice(3).map(l => l.id).sort())
  })

  test('8 · dos reanudaciones SIMULTÁNEAS del mismo job: solo una actúa y no se duplican decisiones', async () => {
    const leads = await makeLeads(4)
    const job = await makeJob(leads.map(l => l.id), { status: 'processing', created_at: minutesAgo(60) })
    await admin.from('crm_leads').update({ contacted_at: minutesAgo(30) }).in('id', leads.slice(0, 2).map(l => l.id))
    const insp: any = await inspectJob(admin, job.id)
    const results: any[] = await Promise.all([
      resumeJob(admin, { jobId: job.id, userId, confirm: true, expectedFingerprint: insp.report.fingerprint }),
      resumeJob(admin, { jobId: job.id, userId, confirm: true, expectedFingerprint: insp.report.fingerprint }),
    ])
    assert.equal(results.filter(r => r.ok).length, 1, JSON.stringify(results.map(r => r.code ?? 'ok')))
    const { count } = await admin.from('crm_email_events').select('id', { count: 'exact', head: true }).eq('event_type', 'email.send_unconfirmed').in('lead_id', leads.map(l => l.id))
    assert.equal(count, 2, 'sin decisiones duplicadas')
  })

  test('9 · un job cerrado no se reabre y no se escribe nada', async () => {
    const leads = await makeLeads(2)
    const job = await makeJob(leads.map(l => l.id), { status: 'failed', error: 'Cerrado manualmente (prueba sintética)', created_at: minutesAgo(60) })
    const before = JSON.stringify((await admin.from('crm_bulk_send_jobs').select('*').eq('id', job.id).single()).data)
    const r: any = await resumeJob(admin, { jobId: job.id, userId, confirm: true, expectedFingerprint: 'x' })
    assert.equal(r.ok, false)
    assert.equal(JSON.stringify((await admin.from('crm_bulk_send_jobs').select('*').eq('id', job.id).single()).data), before)
    const { count } = await admin.from('audit_logs').select('id', { count: 'exact', head: true }).eq('entity_id', job.id)
    assert.equal(count, 0)
  })

  test('6 · un job de hace 30 días se rechaza sin escribir nada', async () => {
    const leads = await makeLeads(2)
    const old = new Date(T0.getTime() - 30 * 24 * 3600 * 1000).toISOString()
    const job = await makeJob(leads.map(l => l.id), { status: 'processing', created_at: old })
    const before = JSON.stringify((await admin.from('crm_bulk_send_jobs').select('*').eq('id', job.id).single()).data)
    const claim = await claimJobBatch(admin, job)
    assert.deepEqual(claim, { ok: false, reason: 'too_old' })
    const after = JSON.stringify((await admin.from('crm_bulk_send_jobs').select('*').eq('id', job.id).single()).data)
    assert.equal(after, before)
  })
})
