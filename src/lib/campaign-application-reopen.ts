// Reglas puras para devolver una postulación "No seleccionada" a "Pendiente".
// Sin imports: se testea directo. Las barreras de campaña/Pro existen para que
// los procesos automáticos (cron de fecha límite y de Plan Pro) no reviertan
// en silencio una reapertura manual.

export type ReopenApplication = {
  application_status: string | null
  origin: string | null
  metadata: Record<string, unknown> | null
}

export type ReopenCampaign = {
  status: string | null
  visibility: string | null
  application_deadline: string | null
  applications_closed_at: string | null
}

export type ReopenCheck = { ok: true } | { ok: false; error: string; status: number }

export function checkReopenAllowed(
  application: ReopenApplication,
  campaign: ReopenCampaign,
  influencerIsPro: boolean,
  now: Date = new Date(),
): ReopenCheck {
  if (application.application_status !== 'rejected') {
    return { ok: false, error: 'Solo se pueden devolver a pendiente postulaciones no seleccionadas', status: 422 }
  }
  if (application.origin !== 'application') {
    return { ok: false, error: 'Las invitaciones rechazadas no se pueden reabrir: la decisión es de la influencer', status: 422 }
  }
  if (application.metadata?.removal_reason) {
    return { ok: false, error: 'Esta postulación fue cerrada por asistencia y no se puede devolver a pendiente', status: 422 }
  }
  if (campaign.status === 'canceled' || campaign.status === 'cancelled') {
    return { ok: false, error: 'La campaña está cancelada', status: 422 }
  }
  // El cron de fecha límite cerraría de nuevo las pendientes si el plazo venció
  // y la campaña aún no está marcada como cerrada.
  if (
    campaign.status === 'active'
    && campaign.application_deadline
    && !campaign.applications_closed_at
    && new Date(campaign.application_deadline).getTime() < now.getTime()
  ) {
    return { ok: false, error: 'La fecha límite de postulación venció: se volvería a cerrar automáticamente', status: 422 }
  }
  // El cron de Plan Pro rechaza pendientes de campañas privadas activas sin Pro.
  if (campaign.visibility === 'private' && campaign.status === 'active' && !influencerIsPro) {
    return { ok: false, error: 'La influencer ya no tiene Plan Pro activo y la campaña es privada: se volvería a cerrar automáticamente', status: 422 }
  }
  return { ok: true }
}
