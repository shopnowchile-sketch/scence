// Plan Pro: una asistencia declinada o vencida sin respuesta NO bloquea cancelar; contenido pendiente sí.
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
register('./support/ts-resolve.mjs', import.meta.url)
const { hasActiveCampaignCommitment, isCommitmentSatisfied } = await import('../src/lib/influencer-pro-commitment.ts')

const now = new Date('2026-10-29T15:00:00Z')

test('isCommitmentSatisfied: asistencia declinada, vencida y confirmada resuelven; pendiente en plazo, no', () => {
  assert.equal(isCommitmentSatisfied({ type: 'event_attendance', status: 'rejected', attendance_response: 'declined', due_date: '2026-11-30' }, now), true)
  assert.equal(isCommitmentSatisfied({ type: 'event_attendance', status: 'rejected', attendance_response: null, due_date: '2026-10-28' }, now), true)
  assert.equal(isCommitmentSatisfied({ type: 'event_attendance', status: 'pending', attendance_response: null, due_date: '2026-10-01' }, now), true)
  assert.equal(isCommitmentSatisfied({ type: 'event_attendance', status: 'approved', attendance_response: 'confirmed', due_date: '2026-10-01' }, now), true)
  assert.equal(isCommitmentSatisfied({ type: 'event_attendance', status: 'pending', attendance_response: null, due_date: '2026-12-01' }, now), false)
})

test('isCommitmentSatisfied: el contenido no cambia (rejected / pending / in_review siguen bloqueando)', () => {
  for (const status of ['rejected', 'pending', 'in_review']) assert.equal(isCommitmentSatisfied({ type: 'reel', status }, now), false, status)
  for (const status of ['approved', 'published']) assert.equal(isCommitmentSatisfied({ type: 'reel', status }, now), true, status)
})

function fakeAdmin(deliverables: unknown[], campaignStatus: string) {
  const rows: Record<string, unknown[]> = {
    campaign_influencers: [{ id: 'ci', campaign_id: 'c1', application_status: 'accepted' }],
    campaigns: [{ id: 'c1', name: 'Camp', status: campaignStatus }],
    campaign_deliverables: deliverables,
  }
  const chain = (table: string): any => ({ select: () => chain(table), eq: () => chain(table), in: () => chain(table), then: (r: any) => r({ data: rows[table], error: null }) })
  return { from: chain } as any
}
const meta = { campaign_id: 'c1' }

test('campaña terminada: asistencia declinada/vencida + contenido aprobado => puede cancelar', async () => {
  const admin = fakeAdmin([
    { id: 'a', campaign_id: 'c1', status: 'rejected', type: 'event_attendance', attendance_response: 'declined', due_date: '2026-10-01' },
    { id: 'r', campaign_id: 'c1', status: 'approved', type: 'reel' },
  ], 'completed')
  assert.equal((await hasActiveCampaignCommitment(admin, 'inf', meta)).blocked, false)
})

test('campaña terminada: contenido pendiente sigue bloqueando', async () => {
  const admin = fakeAdmin([
    { id: 'a', campaign_id: 'c1', status: 'rejected', type: 'event_attendance', attendance_response: null, due_date: '2026-10-01' },
    { id: 'r', campaign_id: 'c1', status: 'pending', type: 'reel' },
  ], 'completed')
  const res = await hasActiveCampaignCommitment(admin, 'inf', meta)
  assert.equal(res.blocked, true)
  assert.equal(res.reason, 'deliverables_pending')
})

test('campaña activa sigue bloqueando aunque la asistencia esté resuelta', async () => {
  const admin = fakeAdmin([{ id: 'a', campaign_id: 'c1', status: 'rejected', type: 'event_attendance', attendance_response: 'declined' }], 'active')
  assert.equal((await hasActiveCampaignCommitment(admin, 'inf', meta)).reason, 'campaign_active')
})
