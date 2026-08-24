export type ManualAttendanceAction = 'confirmed_client' | 'attended' | 'no_show'

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
  } else if (action === 'attended') {
    update.attendance_response = 'confirmed'
    if (currentResponse !== 'confirmed') update.attendance_responded_at = now
    update.attendance_outcome = 'attended'
    update.attendance_outcome_at = now
    update.attendance_note = currentNote || 'Asistencia registrada manualmente'
    update.status = 'approved'
  } else {
    update.attendance_outcome = 'no_show'
    update.attendance_outcome_at = now
    update.attendance_note = currentNote
      ? `${currentNote} · No asistió`
      : 'No asistió · resultado registrado manualmente'
  }
  return update
}
