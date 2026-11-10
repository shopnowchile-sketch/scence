// Contador de Soporte: solo tickets nuevos o con respuesta de la persona; no los pendientes ya respondidos.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'
register('./support/ts-resolve.mjs', import.meta.url)

const { countTicketsAwaitingTeam } = await import('../src/lib/support-tickets.ts')
const t = (id: string, category: string | null = null) => ({ id, category })
const r = (ticket_id: string, is_admin: boolean, at: string) => ({ ticket_id, is_admin, created_at: `2026-11-10T${at}:00Z` })

test('ticket nuevo sin respuesta del equipo cuenta', () => {
  assert.equal(countTicketsAwaitingTeam([t('a')], []), 1)
})
test('ticket ya respondido por el equipo no cuenta', () => {
  assert.equal(countTicketsAwaitingTeam([t('a')], [r('a', true, '10:00')]), 0)
})
test('si la persona responde después de nuestro mensaje, cuenta de nuevo', () => {
  assert.equal(countTicketsAwaitingTeam([t('a')], [r('a', true, '10:00'), r('a', false, '11:00')]), 1)
  assert.equal(countTicketsAwaitingTeam([t('a')], [r('a', false, '09:00'), r('a', true, '10:00')]), 0)
})
test('los tickets de Seguimiento Pro creados por el sistema no cuentan hasta que la influencer escriba', () => {
  assert.equal(countTicketsAwaitingTeam([t('p', 'pro_followup')], []), 0)
  assert.equal(countTicketsAwaitingTeam([t('p', 'pro_followup')], [r('p', false, '12:00')]), 1)
})
test('el menú usa este conteo y no el total de activos', () => {
  const route = readFileSync(new URL('../src/app/api/navigation/summary/route.ts', import.meta.url), 'utf8')
  assert.match(route, /countTicketsAwaitingTeam\(activeTickets, replyRows\)/)
})
