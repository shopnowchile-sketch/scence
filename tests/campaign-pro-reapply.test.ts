import test from 'node:test'
import assert from 'node:assert/strict'
import { canReapplyAfterProExpiry, PRO_EXPIRED_APPLICATION_NOTE } from '../src/lib/campaign-pro-reapply.ts'

test('automated Plan Pro expiry allows a new application on the same row', () => {
  assert.equal(canReapplyAfterProExpiry({ application_status: 'rejected', origin: 'application', notes: PRO_EXPIRED_APPLICATION_NOTE }), true)
})
test('brand rejection never grants self-reapplication', () => {
  assert.equal(canReapplyAfterProExpiry({ application_status: 'rejected', origin: 'application', notes: null }), false)
  assert.equal(canReapplyAfterProExpiry({ application_status: 'rejected', origin: 'application', notes: 'Rechazada por la marca' }), false)
})
test('accepted, pending and rejected invitations are not auto-expired applications', () => {
  assert.equal(canReapplyAfterProExpiry({ application_status: 'accepted', origin: 'application', notes: PRO_EXPIRED_APPLICATION_NOTE }), false)
  assert.equal(canReapplyAfterProExpiry({ application_status: 'pending', origin: 'application', notes: PRO_EXPIRED_APPLICATION_NOTE }), false)
  assert.equal(canReapplyAfterProExpiry({ application_status: 'rejected', origin: 'invitation', notes: PRO_EXPIRED_APPLICATION_NOTE }), false)
})
