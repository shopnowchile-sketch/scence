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

test('el cron nunca escribe campaign_influencers (invariante 16.1)', () => {
  // Vencer la confirmación de asistencia solo rechaza ese entregable, no la
  // participación. El cron no escribe campaign_influencers directamente (si
  // cierra postulaciones lo hace vía el helper compartido de
  // campaign-applications), así que nunca toca campaign_influencers.status.
  const src = readFileSync(new URL('../src/app/api/cron/expire-attendance-confirmations/route.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(src, /from\(\s*['"]campaign_influencers['"]\s*\)\s*\.\s*(update|upsert|insert|delete)\s*\(/)
  assert.doesNotMatch(src, /application_status\s*:/)
  // El entregable de asistencia vencido sí se rechaza.
  assert.match(src, /from\('campaign_deliverables'\)\.update\(\{\s*status: 'rejected'/)
})

test('el cron excluye campañas cerradas en la query y en código', () => {
  const src = readFileSync(new URL('../src/app/api/cron/expire-attendance-confirmations/route.ts', import.meta.url), 'utf8')
  assert.match(src, /\.not\('campaigns\.status', 'in', '\(completed,canceled\)'\)/)
  assert.match(src, /isAttendanceExpirable\(/)
})
