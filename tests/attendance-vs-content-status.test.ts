import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'
import { fileURLToPath } from 'node:url'
import {
  attendanceStatusForResponse, effectiveDeliverableStatus, isAwaitingContentReview, isContentRejected, isDeliverableComplete,
} from '../src/lib/deliverable-status.ts'

register('./support/ts-resolve.mjs', import.meta.url)
const { buildManualAttendanceUpdate } = await import('../src/lib/manual-attendance.ts')

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8')

test('confirmar asistencia se registra como confirmada, sin revisión', () => {
  assert.equal(attendanceStatusForResponse('confirmed'), 'approved')
  assert.equal(attendanceStatusForResponse('declined'), 'rejected')
  assert.equal(attendanceStatusForResponse(null), 'pending')
  const att = { type: 'event_attendance', status: 'in_review', attendance_response: 'confirmed' }
  assert.equal(effectiveDeliverableStatus(att), 'approved')
  assert.equal(isAwaitingContentReview(att), false)
  assert.equal(isContentRejected({ type: 'event_attendance', status: 'rejected', attendance_response: 'declined' }), false)
  assert.equal(isDeliverableComplete(att), true)
})

test('el contenido sí pasa por revisión', () => {
  const reel = { type: 'reel', status: 'in_review', content_url: 'https://x' }
  assert.equal(isAwaitingContentReview(reel), true)
  assert.equal(effectiveDeliverableStatus(reel), 'in_review')
  assert.equal(isContentRejected({ type: 'reel', status: 'rejected' }), true)
})

test('acciones manuales de asistencia dejan status coherente con la respuesta', () => {
  for (const action of ['confirmed_client', 'attended', 'no_show'] as const) {
    const u = buildManualAttendanceUpdate({ action, currentResponse: null, currentNote: null, now: 'n' })
    assert.equal(u.attendance_response, 'confirmed')
    assert.equal(u.status, 'approved', action)
  }
})

test('el equipo no puede aprobar/rechazar una asistencia y los KPI de revisión excluyen asistencia', () => {
  assert.match(read('src/app/api/campaigns/[id]/deliverables/route.ts'), /existing\.type === 'event_attendance' && action !== 'mark_no_show'/)
  assert.match(read('src/app/api/dashboard/route.ts'), /\.neq\('type', 'event_attendance'\)/)
  assert.match(read('src/app/api/analytics/route.ts'), /contentDeliverables/)
})
