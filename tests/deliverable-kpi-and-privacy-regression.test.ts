// Regresión (caso Diego Bravo Orsola): asistencia confirmada + reel aprobado debía dar 100% y 0 pendientes,
// pero varias consultas no traían attendance_response y la asistencia contaba como pendiente/vencida.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { isDeliverableComplete, isDeliverableOverdue } from '../src/lib/deliverable-status.ts'
import { isGoogleDriveUrl, submissionRuleFor, validateSubmissionUrl } from '../src/lib/deliverables/submission-rules.ts'

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8')

test('asistencia aprobada cuenta como completa aunque la consulta no traiga attendance_response', () => {
  assert.equal(isDeliverableComplete({ type: 'event_attendance', status: 'approved' }), true)
  assert.equal(isDeliverableComplete({ type: 'event_attendance', status: 'rejected' }), false)
  assert.equal(isDeliverableComplete({ type: 'event_attendance', status: 'pending' }), false)
})

test('Diego: asistencia + reel aprobados => 100%, sin pendientes ni vencidos', () => {
  const items = [
    { type: 'event_attendance', status: 'approved', attendance_response: 'confirmed', due_date: '2026-09-28' },
    { type: 'reel', status: 'approved', content_url: 'https://instagram.com/reel/x', due_date: '2026-10-05' },
  ]
  assert.equal(items.filter(d => isDeliverableComplete(d)).length, items.length)
  assert.equal(items.filter(d => isDeliverableOverdue(d, '2026-10-29')).length, 0)
})

test('vencido solo si la fecha pasó y no está completo', () => {
  assert.equal(isDeliverableOverdue({ type: 'reel', status: 'pending', due_date: '2026-10-01' }, '2026-10-29'), true)
  assert.equal(isDeliverableOverdue({ type: 'reel', status: 'pending', due_date: '2026-11-01' }, '2026-10-29'), false)
  assert.equal(isDeliverableOverdue({ type: 'reel', status: 'pending', due_date: null }, '2026-10-29'), false)
})

test('toda consulta que cuenta completados pide attendance_response', () => {
  for (const file of [
    'src/app/api/campaigns/route.ts',
    'src/app/api/brand/campaigns/route.ts',
    'src/app/api/campaigns/[id]/report/route.ts',
  ]) assert.match(read(file), /attendance_response/, `${file} debe seleccionar attendance_response`)
})

test('story: solo URL pública de Google Drive; el resto de tipos no cambia', () => {
  assert.equal(submissionRuleFor('story').requiresPublicDrive, true)
  assert.equal(submissionRuleFor('reel').requiresPublicDrive, false)
  assert.equal(isGoogleDriveUrl('https://drive.google.com/file/d/abc/view?usp=sharing'), true)
  assert.equal(isGoogleDriveUrl('https://www.instagram.com/stories/x/123'), false)
  assert.equal(isGoogleDriveUrl('http://drive.google.com/x'), false)
  assert.ok(validateSubmissionUrl('story', 'https://www.instagram.com/stories/x/1'))
  assert.equal(validateSubmissionUrl('story', 'https://drive.google.com/drive/folders/abc'), null)
  assert.equal(validateSubmissionUrl('reel', 'https://www.instagram.com/reel/x'), null)
  assert.match(read('src/app/api/influencer/deliverables/[id]/submit/route.ts'), /validateSubmissionUrl/)
})

test('privacidad: las marcas colaboradoras nunca viajan a la influencer, ni aceptada', () => {
  const my = read('src/app/api/influencer/my-campaigns/route.ts')
  assert.match(my, /metadata: metadataForInfluencer\(campaign\.metadata\) \} \} : row/)
  assert.match(my, /campaign_brands: \[\], metadata: metadataForInfluencer/)
  const one = read('src/app/api/influencer/campaigns/[id]/route.ts')
  assert.ok(one.indexOf('delete payload.campaign_brands') < one.indexOf('if (!operationalAccess)'), 'el borrado debe ser incondicional')
  assert.doesNotMatch(read('src/components/campaigns/CampaignDetailView.influencer.tsx'), /\.\.\.\(c\.campaign_brands/)
})

test('métricas de Instagram: las stories (enlace de Drive) nunca se sincronizan', () => {
  assert.match(read('src/app/api/campaign-deliverables/[id]/sync-metrics/route.ts'), /\['reel', 'post'\]\.includes\(deliverable\.type\)/)
})
