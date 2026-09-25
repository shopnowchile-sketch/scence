export type AttendanceState = 'confirmed' | 'declined' | 'unconfirmed' | 'no_confirmed'

const CAMPAIGN_TIME_ZONE = 'America/Santiago'

export function getCampaignDateKey(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CAMPAIGN_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const value = (type: 'year' | 'month' | 'day') => parts.find(part => part.type === type)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

export function isAttendanceDeadlineExpired(dueDate: string | null | undefined, now = new Date()): boolean {
  if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || Number.isNaN(now.getTime())) return false
  return dueDate < getCampaignDateKey(now)
}

export function getAttendanceState(
  response: string | null | undefined,
  dueDate: string | null | undefined,
  now = new Date(),
): AttendanceState {
  if (response === 'confirmed') return 'confirmed'
  if (response === 'declined') return 'declined'
  return isAttendanceDeadlineExpired(dueDate, now) ? 'no_confirmed' : 'unconfirmed'
}

// Una campaña cerrada (completed/canceled) tiene su historia definida por el
// admin (p. ej. attendance_outcome). El cron de expiración de asistencia no la
// reescribe: un cron que estuvo detenido y se reactiva actúa hacia adelante,
// nunca reconstruye el pasado. Ver auditoría 2026-09-25 (08_CRONS_REACTIVACION).
export const CLOSED_CAMPAIGN_STATUSES = ['completed', 'canceled'] as const

export type AttendanceExpirationCandidate = {
  id: string
  status: string | null
  due_date: string | null
  attendance_response: string | null
  campaign_status: string | null
}

export function isAttendanceExpirable(row: AttendanceExpirationCandidate, now = new Date()): boolean {
  if (row.attendance_response) return false
  if (!row.campaign_status || (CLOSED_CAMPAIGN_STATUSES as readonly string[]).includes(row.campaign_status)) return false
  return isAttendanceDeadlineExpired(row.due_date, now)
}
