// Criterio único de "deliverable completado" — antes había 3-4 versiones
// distintas repartidas entre inf-dash, inf-deliverables, inf-campaigns y
// CampaignDetail (admin/marca), cada una con su propia combinación de
// status/content_url/published_url. Esta es la fuente de verdad única.
//
// Un deliverable se considera completado si:
//   - NO fue rechazado (un rechazo siempre exige una nueva entrega), y
//   - tiene contenido subido (content_url) o publicado (published_url), o
//   - su status ya pasó revisión (approved/published) o quedó marcado
//     "completed" (usado en algunos flujos legacy).
export const DELIVERABLE_COMPLETE_STATUSES = ['approved', 'completed', 'published'] as const

export interface DeliverableStatusFields {
  type?: string | null
  status?: string | null
  content_url?: string | null
  published_url?: string | null
  attendance_response?: string | null
}

export function isDeliverableComplete(d: DeliverableStatusFields): boolean {
  // Asistencia: completa con respuesta (confirmó o avisó que no va) o si ya quedó aprobada/publicada; así una fila
  // sin attendance_response cargado (consulta que no lo pide, dato legado) no cuenta como pendiente.
  if (d.type === 'event_attendance') {
    return !!d.attendance_response || d.status === 'approved' || d.status === 'published' || d.status === 'completed'
  }
  // Un link rechazado sigue guardado para que la influencer y el equipo
  // puedan revisarlo, pero ya no cuenta como avance. Debe volver a pendiente
  // hasta que se suba una corrección y se apruebe.
  if (d.status === 'rejected') return false
  return !!d.content_url || !!d.published_url || DELIVERABLE_COMPLETE_STATUSES.includes(
    (d.status ?? '') as (typeof DELIVERABLE_COMPLETE_STATUSES)[number]
  )
}

// ── Asistencia ≠ contenido ──────────────────────────────────────────────────
// Confirmar asistencia es una decisión de la influencer y se registra de inmediato; NO pasa por revisión
// (la aprobación de la postulación es otro flujo: campaign_influencers.application_status). Solo los
// entregables de contenido (reel, story, etc.) usan pending → in_review → approved/rejected.
export const ATTENDANCE_TYPE = 'event_attendance'

export const isAttendanceDeliverable = (d: { type?: string | null }): boolean => d.type === ATTENDANCE_TYPE

/** La influencer confirmó asistencia. Única definición; también es la compuerta de acceso operativo (brief, lugar exacto). */
export const isAttendanceConfirmed = (d: { attendance_response?: string | null }): boolean => d.attendance_response === 'confirmed'

/** Estado que corresponde a una respuesta de asistencia (confirmed → approved, declined → rejected). */
export function attendanceStatusForResponse(response: string | null | undefined): 'approved' | 'rejected' | 'pending' {
  if (response === 'confirmed') return 'approved'
  if (response === 'declined') return 'rejected'
  return 'pending'
}

/** Estado efectivo para contar o mostrar: en asistencia manda la respuesta; el resto, su status. */
export function effectiveDeliverableStatus(d: DeliverableStatusFields): string {
  if (isAttendanceDeliverable(d) && d.attendance_response) return attendanceStatusForResponse(d.attendance_response)
  return d.status ?? 'pending'
}

/** Solo el contenido espera revisión de la marca/SCENCE; la asistencia nunca. */
export const isAwaitingContentReview = (d: DeliverableStatusFields): boolean =>
  !isAttendanceDeliverable(d) && d.status === 'in_review'

/** Corrección pendiente = contenido rechazado. Una asistencia "No asistiré" no es una corrección. */
export const isContentRejected = (d: DeliverableStatusFields): boolean =>
  !isAttendanceDeliverable(d) && d.status === 'rejected'

/** Vencido = fecha límite (YYYY-MM-DD) anterior a hoy y sin completar. Fuente única para listas, KPI y filtros. */
export const isDeliverableOverdue = (d: DeliverableStatusFields & { due_date?: string | null }, todayKey: string): boolean =>
  !!d.due_date && d.due_date.slice(0, 10) < todayKey && !isDeliverableComplete(d)
