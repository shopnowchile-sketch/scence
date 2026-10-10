// Pruebas de la guarda de envío CRM. Cliente simulado: NO prueban la
// atomicidad real de Postgres (esa depende del UPDATE condicional con lock de
// fila); prueban la lógica que la rodea. Sin envíos reales.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { claimLeadSend, releaseLeadSend, isDefinitiveResendFailure, SEND_GUARD_WINDOW_MS } from '../src/lib/crm-send-guard.ts'

type Call = { table: string; op: string; payload?: unknown; filters: Array<[string, unknown]>; or?: string }

function fakeAdmin(result: { data: unknown; error: { message: string } | null }) {
  const calls: Call[] = []
  const admin = {
    from(table: string) {
      const call: Call = { table, op: '', filters: [] }
      calls.push(call)
      const chain: any = {
        update(payload: unknown) { call.op = 'update'; call.payload = payload; return chain },
        eq(col: string, val: unknown) { call.filters.push([col, val]); return chain },
        or(expr: string) { call.or = expr; return chain },
        select() { return Promise.resolve(result) },
        then(resolve: (v: unknown) => void) { resolve(result) },
      }
      return chain
    },
  }
  return { admin: admin as any, calls }
}

describe('claimLeadSend', () => {
  const now = new Date('2026-10-10T12:00:00.000Z')

  test('reserva con la ventana de 10 minutos como corte', async () => {
    const { admin, calls } = fakeAdmin({ data: [{ id: 'l1' }], error: null })
    const claim = await claimLeadSend(admin, 'l1', null, now)
    assert.equal(claim.claimed, true)
    assert.equal(calls[0].op, 'update')
    assert.deepEqual(calls[0].payload, { contacted_at: now.toISOString() })
    const cutoff = new Date(now.getTime() - SEND_GUARD_WINDOW_MS).toISOString()
    assert.equal(calls[0].or, `contacted_at.is.null,contacted_at.lt.${cutoff}`)
    assert.equal(SEND_GUARD_WINDOW_MS, 600000)
  })

  test('si el UPDATE no modifica filas (otra solicitud ya reservó) NO reserva', async () => {
    const { admin } = fakeAdmin({ data: [], error: null })
    const claim = await claimLeadSend(admin, 'l1', '2026-10-10T11:58:00.000Z', now)
    assert.deepEqual(claim, { claimed: false, reason: 'recent', contactedAt: '2026-10-10T11:58:00.000Z' })
  })

  test('falla cerrado si la base responde con error', async () => {
    const { admin } = fakeAdmin({ data: null, error: { message: 'boom' } })
    const claim = await claimLeadSend(admin, 'l1', null, now)
    assert.deepEqual(claim, { claimed: false, reason: 'error', message: 'boom' })
  })
})

describe('releaseLeadSend', () => {
  test('restaura el valor previo solo si contacted_at sigue siendo el reservado', async () => {
    const { admin, calls } = fakeAdmin({ data: null, error: null })
    await releaseLeadSend(admin, 'l1', { claimed: true, claimedAt: '2026-10-10T12:00:00.000Z', previous: '2026-09-01T00:00:00.000Z' })
    assert.deepEqual(calls[0].payload, { contacted_at: '2026-09-01T00:00:00.000Z' })
    assert.deepEqual(calls[0].filters, [['id', 'l1'], ['contacted_at', '2026-10-10T12:00:00.000Z']])
  })
})

describe('isDefinitiveResendFailure', () => {
  test('errores de validación/auth/cuota son definitivos', () => {
    for (const name of ['validation_error', 'missing_api_key', 'invalid_api_key', 'daily_quota_exceeded', 'rate_limit_exceeded']) {
      assert.equal(isDefinitiveResendFailure({ name }), true, name)
    }
  })
  test('errores 5xx son ambiguos: no se libera la reserva', () => {
    assert.equal(isDefinitiveResendFailure({ name: 'application_error' }), false)
    assert.equal(isDefinitiveResendFailure({ name: 'internal_server_error' }), false)
  })
  test('sin error no es fallo', () => {
    assert.equal(isDefinitiveResendFailure(null), false)
  })
})
