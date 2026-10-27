// Only automated Plan Pro expirations may be reopened by the influencer.
// Brand decisions and expired campaign deadlines are never reopened here.
export const PRO_EXPIRED_APPLICATION_NOTE = 'Postulación cerrada automáticamente: la influencer ya no cuenta con Plan Pro activo.'

export function canReapplyAfterProExpiry(row: {
  application_status?: string | null
  origin?: string | null
  notes?: string | null
} | null | undefined): boolean {
  return row?.application_status === 'rejected' &&
    row.origin === 'application' &&
    row.notes === PRO_EXPIRED_APPLICATION_NOTE
}

/** Una postulación retirada por la propia influencer se conserva como historial y puede volver a postular. */
export function canReapplyAfterWithdrawal(row: {
  application_status?: string | null
  origin?: string | null
} | null | undefined): boolean {
  return row?.application_status === 'withdrawn' && row.origin === 'application'
}
