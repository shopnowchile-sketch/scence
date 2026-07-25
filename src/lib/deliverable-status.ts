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
  if (d.type === 'event_attendance') return !!d.attendance_response
  // Un link rechazado sigue guardado para que la influencer y el equipo
  // puedan revisarlo, pero ya no cuenta como avance. Debe volver a pendiente
  // hasta que se suba una corrección y se apruebe.
  if (d.status === 'rejected') return false
  return !!d.content_url || !!d.published_url || DELIVERABLE_COMPLETE_STATUSES.includes(
    (d.status ?? '') as (typeof DELIVERABLE_COMPLETE_STATUSES)[number]
  )
}
