/**
 * google-calendar.ts
 * Server-side Google Calendar integration usando Service Account.
 * El Service Account tiene acceso de escritura al calendario compartido de SCENCE.
 *
 * Setup:
 *  1. Crear Service Account en Google Cloud Console
 *  2. Habilitar Google Calendar API
 *  3. Compartir el calendario de SCENCE con el email del Service Account (con permisos de edición)
 *  4. Copiar GOOGLE_SERVICE_ACCOUNT_EMAIL y GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY al .env.local
 */

import { google } from 'googleapis'
import type { CreateCalendarEventInput, GoogleCalendarEvent } from '@/types'

const SCENCE_CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID!
const SCOPES = ['https://www.googleapis.com/auth/calendar']

function getAuth() {
  return new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    scopes: SCOPES,
  })
}

function getCalendar() {
  return google.calendar({ version: 'v3', auth: getAuth() })
}

// ── CREATE EVENT ───────────────────────────────────────
export async function createCalendarEvent(
  input: CreateCalendarEventInput
): Promise<GoogleCalendarEvent> {
  const calendar = getCalendar()

  const { data } = await calendar.events.insert({
    calendarId: SCENCE_CALENDAR_ID,
    sendUpdates: 'all',         // notifica a los attendees por email
    requestBody: {
      summary: input.title,
      description: input.description,
      location: input.location,
      start: {
        dateTime: input.startsAt.toISOString(),
        timeZone: input.timeZone ?? 'America/Mexico_City',
      },
      end: {
        dateTime: input.endsAt.toISOString(),
        timeZone: input.timeZone ?? 'America/Mexico_City',
      },
      attendees: input.attendeeEmails?.map(email => ({ email })),
      colorId: '9',             // azul cielo en Google Calendar
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 24 * 60 },   // 1 día antes
          { method: 'popup', minutes: 60 },          // 1 hora antes
        ],
      },
    },
  })

  return data as GoogleCalendarEvent
}

// ── UPDATE EVENT ───────────────────────────────────────
export async function updateCalendarEvent(
  eventId: string,
  input: Partial<CreateCalendarEventInput>
): Promise<GoogleCalendarEvent> {
  const calendar = getCalendar()

  const updateBody: Record<string, unknown> = {}
  if (input.title) updateBody.summary = input.title
  if (input.description !== undefined) updateBody.description = input.description
  if (input.location !== undefined) updateBody.location = input.location
  if (input.startsAt) updateBody.start = { dateTime: input.startsAt.toISOString(), timeZone: input.timeZone ?? 'America/Mexico_City' }
  if (input.endsAt) updateBody.end = { dateTime: input.endsAt.toISOString(), timeZone: input.timeZone ?? 'America/Mexico_City' }
  if (input.attendeeEmails) updateBody.attendees = input.attendeeEmails.map(email => ({ email }))

  const { data } = await calendar.events.patch({
    calendarId: SCENCE_CALENDAR_ID,
    eventId,
    sendUpdates: 'all',
    requestBody: updateBody,
  })

  return data as GoogleCalendarEvent
}

// ── DELETE EVENT ───────────────────────────────────────
export async function deleteCalendarEvent(eventId: string): Promise<void> {
  const calendar = getCalendar()
  await calendar.events.delete({
    calendarId: SCENCE_CALENDAR_ID,
    eventId,
    sendUpdates: 'all',
  })
}

// ── LIST EVENTS ────────────────────────────────────────
export async function listCalendarEvents(
  timeMin: Date,
  timeMax: Date
): Promise<GoogleCalendarEvent[]> {
  const calendar = getCalendar()

  const { data } = await calendar.events.list({
    calendarId: SCENCE_CALENDAR_ID,
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 250,
  })

  return (data.items ?? []) as GoogleCalendarEvent[]
}

// ── GET EVENT ──────────────────────────────────────────
export async function getCalendarEvent(eventId: string): Promise<GoogleCalendarEvent> {
  const calendar = getCalendar()
  const { data } = await calendar.events.get({
    calendarId: SCENCE_CALENDAR_ID,
    eventId,
  })
  return data as GoogleCalendarEvent
}
