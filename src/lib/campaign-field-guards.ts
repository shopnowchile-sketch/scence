// ── Guardas de campos compartidas por rutas API ──────────────────────────────
// Funciones puras, sin acceso a la base. Una sola definición para que cada ruta
// no reimplemente su propio criterio.

type Metadata = Record<string, unknown>

function asMetadata(value: unknown): Metadata {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Metadata : {}
}

/**
 * Campaña "solo por invitación": mismo criterio que usa
 * POST /api/influencer/campaigns/[id]/apply para responder INVITATION_ONLY
 * (`metadata.access_mode === 'invitation'`).
 */
export function isInvitationOnlyCampaign(metadata: unknown): boolean {
  return asMetadata(metadata).access_mode === 'invitation'
}

/**
 * Claves de campaigns.metadata que una influencer puede ver ANTES de ser
 * aceptada (regla 8 de CLAUDE.md: solo información general). Son las mismas
 * que ya se muestran pre-aceptación por otra vía (fecha del evento, nombre del
 * lugar y comuna/región/país). Todo lo demás —dirección, grupo de WhatsApp,
 * instrucciones de llegada, links de referencia/aprobación, datos sponsor—
 * queda fuera hasta application_status = 'accepted'.
 */
const PRE_ACCEPTANCE_METADATA_KEYS = ['access_mode', 'event_date', 'venue_name', 'commune', 'region', 'country'] as const

export function publicCampaignMetadata(metadata: unknown): Metadata {
  const source = asMetadata(metadata)
  const result: Metadata = {}
  for (const key of PRE_ACCEPTANCE_METADATA_KEYS) {
    if (key in source) result[key] = source[key]
  }
  return result
}

/**
 * Limpia un término de búsqueda libre antes de interpolarlo en un filtro
 * PostgREST (`.or('col.ilike.%x%,...')` / `.ilike()`). Quita los caracteres que
 * alteran la gramática del filtro (`,` `(` `)` `"` `\`) y los comodines
 * (`%` `*`), para que el usuario no pueda inyectar condiciones extra.
 */
export function sanitizeSearchTerm(value: string | null | undefined): string {
  return (value ?? '').replace(/[,()"\\%*]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100)
}
