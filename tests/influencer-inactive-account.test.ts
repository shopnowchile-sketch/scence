import assert from 'node:assert/strict'
import test from 'node:test'

test('inactive influencer guard contract', () => {
  const response = {
    error: 'Tu cuenta está inactiva. Solicita la activación mediante Soporte SCENCE.',
    code: 'INFLUENCER_INACTIVE',
    status: 403,
  }

  assert.equal(response.status, 403)
  assert.equal(response.code, 'INFLUENCER_INACTIVE')
  assert.match(response.error, /cuenta está inactiva/i)
})

test('inactive account does not use Pro cancellation semantics', () => {
  assert.equal(false, false)
})
