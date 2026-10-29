// Fuente única de la asistencia: sin porcentajes, pendientes ni vencimientos falsos (regresión Diego Bravo, 2026-10).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { isDeliverableComplete, isDeliverableOverdue, isAttendanceConfirmed, effectiveDeliverableStatus } from '../src/lib/deliverable-status.ts'
import { getAttendanceState } from '../src/lib/attendance-state.ts'

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8')
const pct = (items: Parameters<typeof isDeliverableComplete>[0][]) => Math.round((items.filter(isDeliverableComplete).length / items.length) * 100)

test('estados reales de PROD: confirmada, declinada, vencida sin respuesta, aprobada legada', () => {
  const confirmed = { type: 'event_attendance', status: 'approved', attendance_response: 'confirmed' }
  const declined = { type: 'event_attendance', status: 'rejected', attendance_response: 'declined' }
  const expired = { type: 'event_attendance', status: 'rejected', attendance_response: null, due_date: '2026-10-28' } // cron: sin respuesta
  const legacyApproved = { type: 'event_attendance', status: 'approved', attendance_response: null } // aprobada a mano antes de la regla
  assert.equal(isDeliverableComplete(confirmed), true)
  assert.equal(isDeliverableComplete(declined), true)
  assert.equal(isDeliverableComplete(legacyApproved), true)
  assert.equal(isDeliverableComplete(expired), false) // no confirmó a tiempo: sigue sin completar, y es un vencimiento real
  assert.equal(getAttendanceState(null, '2026-10-28', new Date('2026-10-29T15:00:00Z')), 'no_confirmed')
  assert.equal(effectiveDeliverableStatus(confirmed), 'approved')
})

test('100% cuando todo lo exigido está resuelto, con o sin attendance_response cargado', () => {
  const reel = { type: 'reel', status: 'approved', content_url: 'https://instagram.com/reel/x' }
  assert.equal(pct([{ type: 'event_attendance', status: 'approved', attendance_response: 'confirmed' }, reel]), 100)
  assert.equal(pct([{ type: 'event_attendance', status: 'approved' }, reel]), 100)
  assert.equal(pct([{ type: 'event_attendance', status: 'pending' }, reel]), 50)
  assert.equal(isDeliverableOverdue({ type: 'event_attendance', status: 'approved', due_date: '2026-09-28' }, '2026-10-29'), false)
})

test('confirmación: una sola definición para la compuerta de acceso', () => {
  assert.equal(isAttendanceConfirmed({ attendance_response: 'confirmed' }), true)
  assert.equal(isAttendanceConfirmed({ attendance_response: 'declined' }), false)
  assert.equal(isAttendanceConfirmed({ attendance_response: null }), false)
  for (const f of ['src/app/api/influencer/my-campaigns/route.ts', 'src/app/api/influencer/campaigns/[id]/route.ts', 'src/lib/campaign-asset-access.ts'])
    assert.match(read(f), /isAttendanceConfirmed/, f)
})

test('toda consulta que alimenta isDeliverableComplete selecciona attendance_response', () => {
  const servers = [
    'src/app/api/campaigns/route.ts', 'src/app/api/brand/campaigns/route.ts', 'src/app/api/campaigns/[id]/report/route.ts',
    'src/app/api/campaigns/[id]/deliverables/remind/route.ts', 'src/app/api/campaigns/[id]/influencer-report/route.ts',
    'src/app/api/influencer/campaigns/[id]/report/route.ts', 'src/app/api/influencer/campaigns/route.ts',
    'src/app/api/analytics/route.ts', 'src/app/api/campaigns/[id]/emails/route.ts',
  ]
  for (const f of servers) assert.match(read(f), /attendance_response/, `${f} debe seleccionar attendance_response`)
})

test('sin cálculos paralelos de completado ni alias obsoletos', () => {
  assert.doesNotMatch(read('src/app/(influencer)/inf-deliverables/page.tsx'), /isCompleteDeliverable/)
  assert.match(read('src/app/(dashboard)/admin-campaigns/[id]/CampaignDetail.tsx'), /no_confirmed/)
})
