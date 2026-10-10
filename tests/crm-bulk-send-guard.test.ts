// Pruebas del envío masivo protegido. Usan una base EN MEMORIA que ejecuta cada
// UPDATE condicional de forma síncrona (como el lock de fila de Postgres), por lo
// que las pruebas concurrentes (Promise.all) sí ejercitan la lógica de exclusión.
// NO envían emails: el proveedor es una función simulada. NO tocan Supabase.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  claimJobBatch, finishJobBatch, parseLease, buildLeaseMarker, listInterruptedAttempts,
  loadHandledLeadIds, processLeadBatch, JOB_LEASE_MS, JOB_MAX_AGE_MS,
  type BatchDeps, type BatchLead, type OutgoingEmail,
} from '../src/lib/crm-send-guard.ts'

import { makeAdmin, type Db } from './support/memory-supabase.ts'

const T0 = new Date('2026-10-10T12:00:00.000Z')
const lead = (id: string, over: Partial<BatchLead> = {}): BatchLead =>
  ({ id, contact_name: 'Ana', company_name: 'ACME', email: `${id}@x.cl`, qualification_status: 'unqualified', contacted_at: null, ...over })

function freshDb(leads: BatchLead[]): Db {
  return { crm_leads: leads.map(l => ({ ...l })), crm_email_events: [], crm_lead_activities: [], crm_bulk_send_jobs: [] }
}

function deps(send: OutgoingEmail['send'], over: Partial<BatchDeps> = {}): BatchDeps {
  return {
    isBlocked: () => false,
    pause: async () => {},
    prepare: l => ({ subject: `Hola ${l.id}`, message: 'mensaje', templateKey: 'crm_intro', templateName: 'Intro', send }),
    ...over,
  }
}

describe('processLeadBatch — envío por lead', () => {
  test('envío exitoso: registra evento con job_id y contenido, y marca contacted_at', async () => {
    const leads = [lead('a'), lead('b')]
    const db = freshDb(leads)
    let calls = 0
    const r = await processLeadBatch(makeAdmin(db), { jobId: 'J1', userId: 'u', leads }, deps(async () => ({ id: `r${++calls}`, error: null })))
    assert.deepEqual([r.sent, r.skipped, r.failed, r.unconfirmed], [2, 0, 0, 0])
    assert.equal(calls, 2)
    const ev = db.crm_email_events[0]
    assert.equal(ev.event_type, 'email.sent')
    assert.equal(ev.raw_payload.job_id, 'J1')
    assert.equal(ev.raw_payload.source, 'bulk-send')
    assert.equal(ev.raw_payload.template_key, 'crm_intro')
    assert.equal(ev.raw_payload.message, undefined, 'el contenido no se duplica por lead en el masivo')
    assert.equal(ev.subject, 'Hola a')
    assert.ok(db.crm_leads.every(l => l.contacted_at))
    assert.ok(db.crm_leads.every(l => l.qualification_status === 'contacted'))
  })

  test('dos tandas CONCURRENTES sobre los mismos leads: cada lead recibe UN solo envío', async () => {
    const leads = Array.from({ length: 20 }, (_, i) => lead(`l${i}`))
    const db = freshDb(leads)
    const sentTo: string[] = []
    const mk = () => (l: BatchLead) => ({ subject: 's', message: 'm', templateKey: 'k', templateName: 'n',
      send: async () => { await Promise.resolve(); sentTo.push(l.id); return { id: 'x', error: null } } })
    const d = (): BatchDeps => ({ isBlocked: () => false, pause: async () => {}, prepare: mk() })
    const [a, b] = await Promise.all([
      processLeadBatch(makeAdmin(db), { jobId: 'J1', userId: 'u', leads }, d()),
      processLeadBatch(makeAdmin(db), { jobId: 'J2', userId: 'u', leads }, d()),
    ])
    assert.equal(sentTo.length, 20)
    assert.equal(new Set(sentTo).size, 20)
    assert.equal(a.sent + b.sent, 20)
    assert.equal(a.recentlyContacted + b.recentlyContacted, 20)
  })

  test('envío individual simultáneo (misma reserva) + masivo: un solo envío por lead', async () => {
    const { claimLeadSend } = await import('../src/lib/crm-send-guard.ts')
    const leads = [lead('a')]
    const db = freshDb(leads)
    const individual = await claimLeadSend(makeAdmin(db), 'a', null)   // el envío individual reservó primero
    assert.equal(individual.claimed, true)
    let calls = 0
    const r = await processLeadBatch(makeAdmin(db), { jobId: 'J', userId: 'u', leads }, deps(async () => { calls++; return { id: 'x', error: null } }))
    assert.equal(calls, 0)
    assert.equal(r.recentlyContacted, 1)
  })

  test('lead ya enviado en ESTE job no se reenvía aunque haya pasado la ventana', async () => {
    const leads = [lead('a'), lead('b')]
    const db = freshDb(leads)
    db.crm_email_events.push({ lead_id: 'a', event_type: 'email.sent', raw_payload: { job_id: 'J1' } })
    let calls = 0
    const r = await processLeadBatch(makeAdmin(db), { jobId: 'J1', userId: 'u', leads }, deps(async () => { calls++; return { id: 'x', error: null } }))
    assert.equal(calls, 1)
    assert.equal(r.alreadyHandled, 1)
    assert.equal(r.sent, 1)
  })

  test('un evento de OTRO job no cuenta como ya enviado en este', async () => {
    const leads = [lead('a')]
    const db = freshDb(leads)
    db.crm_email_events.push({ lead_id: 'a', event_type: 'email.sent', raw_payload: { job_id: 'OTRO' } })
    const handled = await loadHandledLeadIds(makeAdmin(db), 'J1', ['a'])
    assert.equal(handled.size, 0)
  })

  test('rechazo definitivo de Resend: libera la reserva y no deja evento', async () => {
    const leads = [lead('a', { contacted_at: '2026-09-01T00:00:00.000Z' })]
    const db = freshDb(leads)
    const r = await processLeadBatch(makeAdmin(db), { jobId: 'J', userId: 'u', leads }, deps(async () => ({ id: null, error: { name: 'validation_error', message: 'bad' } })))
    assert.deepEqual([r.sent, r.failed, r.unconfirmed], [0, 1, 0])
    assert.equal(db.crm_leads[0].contacted_at, '2026-09-01T00:00:00.000Z')
    assert.equal(db.crm_email_events.length, 0)
  })

  for (const [label, sender] of [
    ['excepción de red', async () => { throw new Error('socket hang up') }],
    ['error 5xx del proveedor', async () => ({ id: null, error: { name: 'internal_server_error', message: '500' } })],
  ] as const) {
    test(`resultado AMBIGUO (${label}): conserva la reserva, registra no confirmado y NO reintenta`, async () => {
      const leads = [lead('a')]
      const db = freshDb(leads)
      let calls = 0
      const send = async () => { calls++; return (sender as any)() }
      const first = await processLeadBatch(makeAdmin(db), { jobId: 'J', userId: 'u', leads }, deps(send))
      assert.deepEqual([first.sent, first.failed, first.unconfirmed], [0, 1, 1])
      assert.ok(db.crm_leads[0].contacted_at, 'la reserva se conserva')
      assert.equal(db.crm_email_events[0].event_type, 'email.send_unconfirmed')
      assert.equal(db.crm_email_events[0].raw_payload.job_id, 'J')
      // Reintento inmediato: bloqueado por la ventana.
      await processLeadBatch(makeAdmin(db), { jobId: 'J', userId: 'u', leads }, deps(send))
      assert.equal(calls, 1)
      // Reintento DESPUÉS de la ventana: lo frena el ledger del job.
      db.crm_leads[0].contacted_at = '2026-01-01T00:00:00.000Z'
      const late = await processLeadBatch(makeAdmin(db), { jobId: 'J', userId: 'u', leads }, deps(send))
      assert.equal(calls, 1)
      assert.equal(late.alreadyHandled, 1)
    })
  }

  test('lead en lista de bajas o sin email: no se envía', async () => {
    const leads = [lead('a'), lead('b', { email: null })]
    const db = freshDb(leads)
    let calls = 0
    const r = await processLeadBatch(makeAdmin(db), { jobId: 'J', userId: 'u', leads }, deps(async () => { calls++; return { id: 'x', error: null } }, { isBlocked: () => true }))
    assert.equal(calls, 0)
    assert.equal(r.skipped, 2)
    assert.equal(db.crm_lead_activities.length, 1)
  })

  test('falla el registro DESPUÉS del envío: se cuenta como enviado, se avisa y no se reenvía', async () => {
    const leads = [lead('a')]
    const db = freshDb(leads)
    let calls = 0
    const send = async () => { calls++; return { id: 'x', error: null } }
    const r = await processLeadBatch(makeAdmin(db, { failInsertOn: 'crm_email_events' }), { jobId: 'J', userId: 'u', leads }, deps(send))
    assert.equal(r.sent, 1)
    assert.ok(r.recordErrors >= 1)
    await processLeadBatch(makeAdmin(db), { jobId: 'J', userId: 'u', leads }, deps(send))
    assert.equal(calls, 1, 'la reserva sigue vigente: no hay reenvío')
  })
})

describe('bloqueo del job', () => {
  const job = (over: Record<string, any> = {}) => ({ id: 'J', status: 'processing', cursor: 0, created_at: new Date(T0.getTime() - 60_000).toISOString(), error: null as string | null, ...over })
  const dbWith = (j: any): Db => ({ crm_bulk_send_jobs: [{ ...j }], crm_leads: [], crm_email_events: [], crm_lead_activities: [] })

  test('dos invocaciones simultáneas del mismo job: solo UNA toma la tanda', async () => {
    const j = job()
    const db = dbWith(j)
    const [a, b] = await Promise.all([claimJobBatch(makeAdmin(db), j, T0, 'A'), claimJobBatch(makeAdmin(db), j, T0, 'B')])
    assert.equal([a, b].filter(c => c.ok).length, 1)
    assert.equal([a, b].filter(c => !c.ok && c.reason === 'busy').length, 1)
  })

  test('mientras el lease sigue vigente, otra invocación recibe busy sin escribir', async () => {
    const marker = buildLeaseMarker('A', new Date(T0.getTime() + 60_000))
    const j = job({ error: marker })
    const db = dbWith(j)
    const c = await claimJobBatch(makeAdmin(db), j, T0, 'B')
    assert.deepEqual(c, { ok: false, reason: 'busy' })
    assert.equal(db.crm_bulk_send_jobs[0].error, marker)
  })

  test('lease vencido (holder muerto): lo toma exactamente una invocación', async () => {
    const marker = buildLeaseMarker('A', new Date(T0.getTime() - 1000))
    const j = job({ error: marker })
    const db = dbWith(j)
    const [a, b] = await Promise.all([claimJobBatch(makeAdmin(db), j, T0, 'B'), claimJobBatch(makeAdmin(db), j, T0, 'C')])
    assert.equal([a, b].filter(c => c.ok).length, 1)
  })

  test('no reactiva jobs antiguos (los 20 históricos son de julio a septiembre)', async () => {
    const historicos = ['2026-07-08T23:44:26Z', '2026-07-10T02:08:52Z', '2026-08-27T22:53:17Z', '2026-09-07T16:47:25Z', '2026-09-09T21:03:39Z']
    for (const created_at of historicos) {
      for (const status of ['pending', 'processing']) {
        const j = job({ created_at, status })
        const db = dbWith(j)
        const before = JSON.stringify(db.crm_bulk_send_jobs)
        const c = await claimJobBatch(makeAdmin(db), j, T0)
        assert.deepEqual(c, { ok: false, reason: 'too_old' }, `${created_at} ${status}`)
        assert.equal(JSON.stringify(db.crm_bulk_send_jobs), before, 'no escribe nada')
      }
    }
    const justUnder = job({ created_at: new Date(T0.getTime() - JOB_MAX_AGE_MS + 1000).toISOString() })
    assert.equal((await claimJobBatch(makeAdmin(dbWith(justUnder)), justUnder, T0)).ok, true)
  })

  test('jobs failed o completed no se procesan', async () => {
    for (const status of ['failed', 'completed']) {
      const j = job({ status })
      assert.deepEqual(await claimJobBatch(makeAdmin(dbWith(j)), j, T0), { ok: false, reason: 'closed' })
    }
  })

  test('el avance solo se guarda con el lease propio; un lease perdido no pisa al nuevo dueño', async () => {
    const j = job()
    const db = dbWith(j)
    const mine = await claimJobBatch(makeAdmin(db), j, T0, 'A')
    assert.ok(mine.ok)
    // El lease vence y otro toma el job.
    const later = new Date(T0.getTime() + JOB_LEASE_MS + 1000)
    const row = db.crm_bulk_send_jobs[0]
    const takeover = await claimJobBatch(makeAdmin(db), { ...j, error: row.error }, later, 'B')
    assert.ok(takeover.ok)
    const stale = await finishJobBatch(makeAdmin(db), 'J', (mine as any).marker, { cursor: 50 })
    assert.equal(stale.held, false)
    assert.equal(db.crm_bulk_send_jobs[0].cursor, 0)
    const ok = await finishJobBatch(makeAdmin(db), 'J', (takeover as any).marker, { cursor: 50 })
    assert.equal(ok.held, true)
    assert.equal(db.crm_bulk_send_jobs[0].cursor, 50)
    assert.equal(db.crm_bulk_send_jobs[0].error, null)
  })

  test('parseLease reconoce el marcador y descarta mensajes de error normales', () => {
    const exp = new Date('2026-10-10T12:03:00.000Z')
    const parsed = parseLease(buildLeaseMarker('tok-1', exp))
    assert.equal(parsed?.expiresAt.toISOString(), exp.toISOString())
    assert.equal(parsed?.token, 'tok-1')
    assert.equal(parseLease('Tanda abortada sin enviar'), null)
    assert.equal(parseLease(null), null)
  })

  test('intentos interrumpidos: reservados sin evento del job (para revisión manual)', async () => {
    const db: Db = { crm_leads: [{ id: 'a', contacted_at: '2026-10-10T12:00:00Z' }, { id: 'b', contacted_at: '2026-10-10T12:00:01Z' }, { id: 'c', contacted_at: null }], crm_email_events: [{ lead_id: 'a', event_type: 'email.sent', raw_payload: { job_id: 'J' } }] }
    const interrupted = await listInterruptedAttempts(makeAdmin(db), 'J', ['a', 'b', 'c'], '2026-10-10T11:59:00Z')
    assert.deepEqual(interrupted, ['b'])
  })
})
