import test from 'node:test'
import assert from 'node:assert/strict'
import { canReapplyAfterWithdrawal } from '../src/lib/campaign-pro-reapply.ts'

test('solo una postulación propia retirada puede volver a postular', () => {
  assert.equal(canReapplyAfterWithdrawal({ application_status: 'withdrawn', origin: 'application' }), true)
  assert.equal(canReapplyAfterWithdrawal({ application_status: 'withdrawn', origin: 'invitation' }), false)
  assert.equal(canReapplyAfterWithdrawal({ application_status: 'rejected', origin: 'application' }), false)
  assert.equal(canReapplyAfterWithdrawal({ application_status: 'pending', origin: 'application' }), false)
  assert.equal(canReapplyAfterWithdrawal(null), false)
})
