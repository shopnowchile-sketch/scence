// KPI "completado": una sola definición (lib/deliverable-status) usada por
// listas de campañas, dashboards, reportes, Analytics y rankings.
// Los casos replican la distribución real de producción (auditoría KPI
// 2026-10-12): casi nada está 'published', 'progress' siempre es 0 y hay
// entregables en revisión con link ya subido.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isDeliverableComplete } from '../src/lib/deliverable-status.ts'

test('aprobado cuenta como completado aunque progress sea 0 y no esté publicado', () => {
  assert.equal(isDeliverableComplete({ type: 'reel', status: 'approved', content_url: null, published_url: null }), true)
})

test('aprobado NO se trata como publicado: ambos completan, pero son estados distintos', () => {
  const approved = { type: 'reel', status: 'approved' }
  const published = { type: 'reel', status: 'published' }
  assert.equal(isDeliverableComplete(approved), true)
  assert.equal(isDeliverableComplete(published), true)
  assert.notEqual(approved.status, published.status)
})

test('en revisión con link subido cuenta como entregado; sin link no', () => {
  assert.equal(isDeliverableComplete({ type: 'reel', status: 'in_review', content_url: 'https://instagram.com/reel/x' }), true)
  assert.equal(isDeliverableComplete({ type: 'reel', status: 'in_review', content_url: null }), false)
})

test('rechazado nunca completa, aunque conserve el link anterior', () => {
  assert.equal(isDeliverableComplete({ type: 'reel', status: 'rejected', content_url: 'https://instagram.com/reel/x' }), false)
})

test('pendiente sin link no completa', () => {
  assert.equal(isDeliverableComplete({ type: 'story', status: 'pending' }), false)
})

test('asistencia a evento completa solo si hay respuesta', () => {
  assert.equal(isDeliverableComplete({ type: 'event_attendance', status: 'pending', attendance_response: 'confirmed' }), true)
  assert.equal(isDeliverableComplete({ type: 'event_attendance', status: 'pending', attendance_response: null }), false)
  assert.equal(isDeliverableComplete({ type: 'event_attendance', status: 'pending' }), false)
})

test('las pantallas de KPI usan la fuente única y no listas de estados propias', () => {
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
  for (const file of [
    'src/lib/influencers/ranking.ts',
    'src/app/api/analytics/route.ts',
    'src/app/api/campaigns/[id]/influencer-report/route.ts',
    'src/app/api/influencer/campaigns/[id]/report/route.ts',
    'src/app/(dashboard)/admin-campaigns/[id]/report/page.tsx',
    'src/app/(dashboard)/admin-campaigns/[id]/CampaignDetail.tsx',
  ]) {
    assert.match(read(file), /isDeliverableComplete/, `${file} debe usar isDeliverableComplete`)
  }
  assert.doesNotMatch(read('src/lib/influencers/ranking.ts'), /\['published', 'approved', 'completed'\]/)
  assert.doesNotMatch(read('src/app/api/analytics/route.ts'), /byStatus\.published \/ allDeliverables/)
})
