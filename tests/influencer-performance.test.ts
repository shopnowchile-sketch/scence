// Desempeño interno y criterios de segmentación: reglas puras + guardas de seguridad de las rutas.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'
register('./support/ts-resolve.mjs', import.meta.url)

const { summarizePerformance, matchesCriteria, sanitizeCriteria, EMPTY_PERFORMANCE } = await import('../src/lib/influencer-performance.ts')
const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

const NOW = new Date('2026-11-10T15:00:00Z')
const base = { influencer_id: 'i', campaign_id: 'c', type: 'reel', status: 'pending', due_date: null, content_url: null, published_url: null,
  submitted_at: null, published_at: null, attendance_response: null, attendance_outcome: null, campaign_status: 'active' }
const att = (over = {}) => ({ ...base, type: 'event_attendance', due_date: '2026-11-01', ...over })

test('avisó que no asistía ≠ no asistió: solo no_show es incumplimiento', () => {
  const { summary } = summarizePerformance([
    att({ attendance_outcome: 'excused_absence' }),
    att({ attendance_response: 'declined' }),
    att({ attendance_outcome: 'no_show' }),
    att({ attendance_outcome: 'attended' }),
  ], [], NOW)
  assert.deepEqual(summary.attendance, { attended: 1, excused: 2, no_show: 1, pending: 0 })
  assert.equal(summary.compliance, Math.round(((1 + 0.5 + 0.5 + 0) / 4) * 100))
})

test('entregable dentro de plazo es pendiente y no penaliza; vencido sí', () => {
  const { summary } = summarizePerformance([
    { ...base, due_date: '2026-11-20' },
    { ...base, due_date: '2026-11-01' },
  ], [], NOW)
  assert.equal(summary.deliverables.pending, 1)
  assert.equal(summary.deliverables.overdue, 1)
  assert.equal(summary.compliance, 0)
})

test('entregado a tiempo vs con atraso; campañas canceladas no cuentan', () => {
  const { summary } = summarizePerformance([
    { ...base, status: 'approved', due_date: '2026-11-05', submitted_at: '2026-11-04T12:00:00Z' },
    { ...base, status: 'approved', due_date: '2026-11-05', submitted_at: '2026-11-08T12:00:00Z' },
    { ...base, due_date: '2026-11-01', campaign_status: 'canceled' },
  ], [{ influencer_id: 'i', campaign_id: 'c', campaign_status: 'completed' }, { influencer_id: 'i', campaign_id: 'x', campaign_status: 'canceled' }], NOW)
  assert.equal(summary.deliverables.on_time, 1)
  assert.equal(summary.deliverables.late, 1)
  assert.equal(summary.deliverables.overdue, 0)
  assert.equal(summary.campaigns_completed, 1)
  assert.equal(summary.campaigns_participated, 1)
})

test('sin compromisos resueltos no se inventa puntaje', () => {
  assert.equal(summarizePerformance([], [], NOW).summary.compliance, null)
})

test('criterios: rangos, datos faltantes no pasan y sin criterios todo pasa', () => {
  const subject = { followers: 5000, engagement: 3, rating: 4.5, performance: EMPTY_PERFORMANCE }
  assert.equal(matchesCriteria({}, { ...subject, followers: null }), true)
  assert.equal(matchesCriteria({ followers_min: 1000, followers_max: 10000 }, subject), true)
  assert.equal(matchesCriteria({ followers_min: 6000 }, subject), false)
  assert.equal(matchesCriteria({ followers_min: 1000 }, { ...subject, followers: null }), false)
  assert.equal(matchesCriteria({ engagement_max: 2 }, subject), false)
  assert.equal(matchesCriteria({ rating_min: 4 }, subject), true)
  assert.equal(matchesCriteria({ compliance_min: 80 }, subject), false)
  assert.equal(matchesCriteria({ no_shows_max: 0 }, subject), true)
})

test('sanitizeCriteria: solo claves conocidas y números válidos', () => {
  assert.deepEqual(sanitizeCriteria({ followers_min: '1000', evil: 1, rating_max: -1, late_max: 'x', engagement_min: '' }), { followers_min: 1000 })
})

test('rutas: criterios se aplican en todos los puntos de entrada y el desempeño es solo Admin', () => {
  for (const file of ['src/app/api/influencer/campaigns/open/route.ts', 'src/app/api/influencer/campaigns/[id]/apply/route.ts', 'src/app/api/influencer/campaigns/[id]/route.ts', 'src/lib/campaign-notifications.ts']) {
    assert.match(read(file), /audienceMatcherFor\([^)]*\[?[^)]*\]|audienceMatcherFor\(admin, \[[^\]]*\], /, file)
    assert.match(read(file), /allows\([^)]*,[^)]*,[^)]*\)/, file)
  }
  assert.match(read('src/app/api/influencers/[id]/performance/route.ts'), /isPlatformAdmin/)
  assert.match(read('src/lib/campaign-locations.ts'), /audience_criteria/)
  assert.match(read('src/app/api/brands/route.ts'), /managed_by_brand_id/)
})
