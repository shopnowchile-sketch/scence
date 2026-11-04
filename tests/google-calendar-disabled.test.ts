// Google Calendar desactivado por defecto hasta que el requerimiento esté completo (2026-11-04).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'

register('./support/ts-resolve.mjs', import.meta.url)
const lib = await import('../src/lib/google-calendar.ts')

test('sin GOOGLE_CALENDAR_ENABLED=true la integración está apagada y no llega a Google', async () => {
  delete process.env.GOOGLE_CALENDAR_ENABLED
  assert.equal(lib.isGoogleCalendarEnabled(), false)
  process.env.GOOGLE_CALENDAR_ENABLED = '1'
  assert.equal(lib.isGoogleCalendarEnabled(), false, 'solo el valor exacto "true" la activa')
  delete process.env.GOOGLE_CALENDAR_ENABLED
  const input = { title: 't', startsAt: new Date(), endsAt: new Date() } as any
  await assert.rejects(lib.createCalendarEvent(input), /desactivado/)
  await assert.rejects(lib.updateCalendarEvent('e', input), /desactivado/)
  await assert.rejects(lib.deleteCalendarEvent('e'), /desactivado/)
})

test('las reservas no invocan Calendar cuando está apagado', () => {
  const route = readFileSync(new URL('../src/app/api/bookings/route.ts', import.meta.url), 'utf8')
  assert.match(route, /if \(isGoogleCalendarEnabled\(\)\) try \{\s*const gcalEvent = await createCalendarEvent/)
  assert.match(route, /calendar_event_id && isGoogleCalendarEnabled\(\)\) \{\s*try \{\s*await updateCalendarEvent/)
  assert.match(route, /calendar_event_id && isGoogleCalendarEnabled\(\)\) \{\s*try \{ await deleteCalendarEvent/)
})
