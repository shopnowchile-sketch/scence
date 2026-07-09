// Criterio único de "deliverable completado" — antes había 3-4 versiones
// distintas repartidas entre inf-dash, inf-tasks, inf-campaigns y
// CampaignDetail (admin/marca), cada una con su propia combinación de
// status/content_url/published_url. Esta es la fuente de verdad única.
//
// Un deliverable se considera completado si:
//   - tiene contenido subido (content_url) o publicado (published_url), o
//   - su status ya pasó revisión (approved/published) o quedó marcado
//     "completed" (usado en algunos flujos legacy).
export const DELIVERABLE_COMPLETE_STATUSES = ['approved', 'completed', 'published'] as const

export interface DeliverableStatusFields {
  status?: string | null
  content_url?: string | null
  published_url?: string | null
}

export function isDeliverableComplete(d: DeliverableStatusFields): boolean {
  return !!d.content_url || !!d.published_url || DELIVERABLE_COMPLETE_STATUSES.includes(
    (d.status ?? '') as (typeof DELIVERABLE_COMPLETE_STATUSES)[number]
  )
}
