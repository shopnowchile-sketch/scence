import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { checkReopenAllowed } from '../src/lib/campaign-application-reopen.ts'

const app = { application_status: 'rejected', origin: 'application', metadata: null }
const camp = { status: 'active', visibility: 'open', application_deadline: null, applications_closed_at: null }
const NOW = new Date('2026-10-13T12:00:00Z')

test('postulación rechazada en campaña activa abierta: se puede reabrir', () => {
  assert.deepEqual(checkReopenAllowed(app, camp, true, NOW), { ok: true })
})
test('solo desde rejected (pendiente/aceptada no)', () => {
  for (const st of ['pending', 'accepted', null]) {
    const r = checkReopenAllowed({ ...app, application_status: st }, camp, true, NOW)
    assert.equal(r.ok, false)
  }
})
test('invitación rechazada por la influencer no se reabre', () => {
  const r = checkReopenAllowed({ ...app, origin: 'invitation' }, camp, true, NOW)
  assert.equal(r.ok, false)
})
test('cierre por asistencia (removal_reason) no se reabre', () => {
  const r = checkReopenAllowed({ ...app, metadata: { removal_reason: 'attendance_deadline_closed' } }, camp, true, NOW)
  assert.equal(r.ok, false)
})
test('campaña cancelada: bloqueado', () => {
  assert.equal(checkReopenAllowed(app, { ...camp, status: 'canceled' }, true, NOW).ok, false)
})
test('campaña completada: permitido (el cierre automático solo corre al completarse)', () => {
  assert.equal(checkReopenAllowed(app, { ...camp, status: 'completed' }, true, NOW).ok, true)
})
test('plazo vencido sin cierre: bloqueado; con postulaciones ya cerradas: permitido', () => {
  const vencida = { ...camp, application_deadline: '2026-10-01T00:00:00Z' }
  assert.equal(checkReopenAllowed(app, vencida, true, NOW).ok, false)
  assert.equal(checkReopenAllowed(app, { ...vencida, applications_closed_at: '2026-10-02T00:00:00Z' }, true, NOW).ok, true)
  assert.equal(checkReopenAllowed(app, { ...camp, application_deadline: '2026-11-01T00:00:00Z' }, true, NOW).ok, true)
})
test('campaña privada activa sin Plan Pro: bloqueado; con Pro o abierta: permitido', () => {
  const priv = { ...camp, visibility: 'private' }
  assert.equal(checkReopenAllowed(app, priv, false, NOW).ok, false)
  assert.equal(checkReopenAllowed(app, priv, true, NOW).ok, true)
  assert.equal(checkReopenAllowed(app, camp, false, NOW).ok, true)
})

test('reopenCampaignApplication: UPDATE condicionado a rejected, sin emails, limpia fechas y notas automáticas', () => {
  const src = readFileSync(new URL('../src/lib/campaign-applications.ts', import.meta.url), 'utf8')
  const fn = src.slice(src.indexOf('export async function reopenCampaignApplication'), src.indexOf('export const AUTO_CLOSE_NOTES'))
  assert.match(fn, /\.eq\('application_status', 'rejected'\)/)
  assert.match(fn, /application_status: 'pending', rejected_at: null/)
  assert.match(fn, /startsWith\('Postulación cerrada automáticamente'\)/)
  assert.doesNotMatch(fn, /getResend|emails\.send/)
})

test('endpoint admin: reopen pasa por autorización central y no existe en el portal marca', () => {
  const admin = readFileSync(new URL('../src/app/api/campaigns/[id]/applications/route.ts', import.meta.url), 'utf8')
  assert.ok(admin.indexOf("authorizeCampaignBrandAction(user.id, params.id, 'application.manage')") < admin.indexOf('reopenCampaignApplication(admin'))
  const brand = readFileSync(new URL('../src/app/api/brand/campaigns/[id]/applications/route.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(brand, /reopen/)
})
