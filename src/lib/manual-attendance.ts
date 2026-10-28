import { attendanceStatusForResponse } from './deliverable-status'

export type ManualAttendanceAction = 'confirmed_client' | 'declined_admin' | 'attended' | 'no_show' | 'no_show_unconfirmed' | 'revert_no_show'

export function buildManualAttendanceUpdate({
  action,
  currentResponse,
  currentNote,
  now,
}: {
  action: ManualAttendanceAction
  currentResponse: string | null
  currentNote: string | null
  now: string
}): Record<string, string | null> {
  const update: Record<string, string | null> = { updated_at: now }
  if (action === 'confirmed_client') {
    update.attendance_response = 'confirmed'
    update.attendance_responded_at = now
    update.attendance_note = 'Confirmó con el cliente · confirmación registrada manualmente'
    update.status = attendanceStatusForResponse('confirmed')
  } else if (action === 'declined_admin') {
    update.attendance_response = 'declined'
    update.attendance_responded_at = now
    update.attendance_note = 'No asistirá · registrado manualmente por el equipo'
    update.status = attendanceStatusForResponse('declined')
  } else if (action === 'attended') {
    update.attendance_response = 'confirmed'
    if (currentResponse !== 'confirmed') update.attendance_responded_at = now
    update.attendance_outcome = 'attended'
    update.attendance_outcome_at = now
    update.attendance_note = currentNote || 'Asistencia registrada manualmente'
    update.status = attendanceStatusForResponse('confirmed')
  } else if (action === 'no_show') {
    update.attendance_response = 'confirmed'
    if (currentResponse !== 'confirmed') update.attendance_responded_at = now
    update.attendance_outcome = 'no_show'
    update.attendance_outcome_at = now
    update.attendance_note = 'Confirmó con el cliente · No asistió'
    update.status = attendanceStatusForResponse('confirmed')
  } else if (action === 'revert_no_show') {
    update.attendance_outcome = null
    update.attendance_outcome_at = null
    update.attendance_note = null
  } else {
    update.attendance_outcome = 'no_show'
    update.attendance_outcome_at = now
    update.attendance_note = 'No confirmó · No asistió'
  }
  return update
}
