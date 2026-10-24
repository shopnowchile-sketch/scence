import test from 'node:test'
import assert from 'node:assert/strict'
import { rateLimit, resetRateLimits } from '../src/lib/simple-rate-limit.ts'

test('rateLimit permite hasta el límite y luego bloquea dentro de la ventana', () => {
  resetRateLimits()
  const t0 = 1_000_000
  assert.equal(rateLimit('ip:1', 2, 60_000, t0), true)
  assert.equal(rateLimit('ip:1', 2, 60_000, t0 + 1), true)
  assert.equal(rateLimit('ip:1', 2, 60_000, t0 + 2), false)
  assert.equal(rateLimit('ip:2', 2, 60_000, t0 + 2), true)
})

test('rateLimit vuelve a permitir al vencer la ventana', () => {
  resetRateLimits()
  const t0 = 5_000_000
  rateLimit('ip:3', 1, 1000, t0)
  assert.equal(rateLimit('ip:3', 1, 1000, t0 + 500), false)
  assert.equal(rateLimit('ip:3', 1, 1000, t0 + 1500), true)
})
