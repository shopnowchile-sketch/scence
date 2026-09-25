// Regla del cron expire-attendance-confirmations (auditoría 2026-09-25):
// un cron reactivado actúa hacia adelante y nunca reescribe campañas cerradas.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isAttendanceExpirable } from '../src/lib/attendance-state.ts'

// 25-09-2026 12:15 UTC (hora del cron) = 25-09 en Chile
const NOW = new Date('2026-09-25T12:15:00Z')
const base = { id: 'd1', status: 'pending', due_date: '2026-09-20', attendance_response: null, campaign_status: 'active' }

test('campaña activa con plazo vencido y sin respuesta → expira (libera cupo)', () => {
  assert.equal(isAttendanceExpirable(base, NOW), true)
})

test('campaña completed → no se toca (caso de los 25 históricos)', () => {
  assert.equal(isAttendanceExpirable({ ...base, due_date: '2026-08-19', campaign_status: 'completed' }, NOW), false)
})

test('campaña canceled → no se toca', () => {
  assert.equal(isAttendanceExpirable({ ...base, campaign_status: 'canceled' }, NOW), false)
})

test('estado de campaña desconocido → falla cerrado', () => {
  assert.equal(isAttendanceExpirable({ ...base, campaign_status: null }, NOW), false)
})

test('ya respondió → no expira', () => {
  assert.equal(isAttendanceExpirable({ ...base, attendance_response: 'confirmed' }, NOW), false)
})

test('plazo hoy o futuro → no expira', () => {
  assert.equal(isAttendanceExpirable({ ...base, due_date: '2026-09-25' }, NOW), false)
  assert.equal(isAttendanceExpirable({ ...base, due_date: '2026-10-01' }, NOW), false)
})

test('sin fecha límite → no expira', () => {
  assert.equal(isAttendanceExpirable({ ...base, due_date: null }, NOW), false)
})

test('el cron nunca escribe campaign_influencers.status (invariante 16.1)', () => {
  const src = readFileSync(new URL('../src/app/api/cron/expire-attendance-confirmations/route.ts', import.meta.url), 'utf8')
  const update = src.slice(src.indexOf(".from('campaign_influencers').update("))
  const block = update.slice(0, update.indexOf('})'))
  assert.doesNotMatch(block, /^\s*status\s*:/m)
  assert.match(block, /application_status: 'rejected'/)
})

test('el cron excluye campañas cerradas en la query y en código', () => {
  const src = readFileSync(new URL('../src/app/api/cron/expire-attendance-confirmations/route.ts', import.meta.url), 'utf8')
  assert.match(src, /\.not\('campaigns\.status', 'in', '\(completed,canceled\)'\)/)
  assert.match(src, /isAttendanceExpirable\(/)
})
