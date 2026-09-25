// Orden por defecto de la lista de campañas: activas arriba, completadas y
// canceladas abajo; dentro de cada grupo, la última modificada primero.
import test from 'node:test'
import assert from 'node:assert/strict'
import { compareCampaignsByPriority } from '../src/lib/campaign-list-order.ts'

const c = (name: string, status: string, updated_at: string | null, created_at = '2026-01-01T00:00:00Z') =>
  ({ name, status, updated_at, created_at })

test('activas arriba, completadas y canceladas al final', () => {
  const list = [
    c('done-new', 'completed', '2026-09-25T00:00:00Z'),
    c('active-old', 'active', '2026-08-01T00:00:00Z'),
    c('canceled', 'canceled', '2026-09-24T00:00:00Z'),
    c('draft', 'draft', '2026-09-20T00:00:00Z'),
  ].sort(compareCampaignsByPriority).map(x => x.name)
  assert.deepEqual(list, ['active-old', 'draft', 'done-new', 'canceled'])
})

test('dentro del mismo estado, la última modificada primero', () => {
  const list = [
    c('a', 'active', '2026-09-01T00:00:00Z'),
    c('b', 'active', '2026-09-20T00:00:00Z'),
    c('c', 'active', '2026-09-10T00:00:00Z'),
  ].sort(compareCampaignsByPriority).map(x => x.name)
  assert.deepEqual(list, ['b', 'c', 'a'])
})

test('sin updated_at usa created_at; estado desconocido queda antes de las cerradas', () => {
  const list = [
    c('done', 'completed', '2026-09-25T00:00:00Z'),
    c('weird', 'archived', null, '2026-09-01T00:00:00Z'),
    c('act', 'active', null, '2026-09-02T00:00:00Z'),
  ].sort(compareCampaignsByPriority).map(x => x.name)
  assert.deepEqual(list, ['act', 'weird', 'done'])
})
