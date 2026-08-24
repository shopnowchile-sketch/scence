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
