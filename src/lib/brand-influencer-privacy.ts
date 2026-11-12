// Privacidad de influencers hacia las marcas (decisión de la fundadora, 2026-11-02): una marca ve a las influencers que
// postularon, participaron o están en su roster, pero NUNCA sus datos de contacto (email, teléfono, WhatsApp) ni
// identificadores internos de cuenta (user_id). Fuente única: toda respuesta a marcas que embeba `influencer` pasa por aquí.
// Módulo PURO (sin imports de servidor).

const CONTACT_KEYS = ['email', 'phone', 'whatsapp', 'user_id'] as const

type Obj = Record<string, unknown>

/** Copia del objeto influencer sin contacto ni identificadores internos. null/undefined se devuelven tal cual. */
export function withoutInfluencerContact<T>(influencer: T): T {
  if (!influencer || typeof influencer !== 'object' || Array.isArray(influencer)) return influencer
  const copy: Obj = { ...(influencer as Obj) }
  for (const key of CONTACT_KEYS) delete copy[key]
  return copy as T
}

/** Para filas con una relación `influencer` embebida (campaign_influencers, barters, ...): la limpia, el resto queda igual. */
export function scrubInfluencerRelation<T extends { influencer?: unknown }>(row: T): T {
  return row && 'influencer' in row ? { ...row, influencer: withoutInfluencerContact(row.influencer) } : row
}

/** Vista de marca de una campaña con `campaign_influencers[].influencer`: misma campaña, influencers sin contacto. */
export function scrubCampaignInfluencers<T extends { campaign_influencers?: unknown }>(campaign: T): T {
  const rows = campaign.campaign_influencers
  return Array.isArray(rows) ? { ...campaign, campaign_influencers: rows.map(scrubInfluencerRelation) } : campaign
}

// ── Vista de marca del detalle de campaña (2026-11-12) ─────────────────────────────────────────────────────────
// Una marca no recibe: notas internas (campaña ni participantes), metadata privada de los participantes ni datos de
// contacto de OTRAS marcas (solo id, nombre y logo). Se conservan las claves de metadata que la pantalla compartida
// con Admin necesita para mostrar el estado de la participación.
const PARTICIPANT_METADATA_ALLOWED = ['removal_reason', 'last_reminder_sent_at'] as const

function withoutBrandContact(brand: unknown, ownBrandId: string | null): unknown {
  if (!brand || typeof brand !== 'object' || Array.isArray(brand)) return brand
  const b = brand as Obj
  if (ownBrandId && b.id === ownBrandId) return brand
  return { id: b.id, name: b.name, logo_url: b.logo_url, ...('instagram' in b ? { instagram: b.instagram } : {}) }
}

function participantForBrand(row: unknown): unknown {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return row
  const { notes: _notes, message: _message, metadata, ...rest } = row as Obj
  const source = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata as Obj : {}
  const allowed: Obj = {}
  for (const key of PARTICIPANT_METADATA_ALLOWED) if (key in source) allowed[key] = source[key]
  return scrubInfluencerRelation({ ...rest, metadata: allowed } as { influencer?: unknown })
}

export function brandCampaignView<T extends Obj>(campaign: T, ownBrandId: string | null): T {
  const { internal_notes: _internal, ...rest } = campaign
  const view: Obj = { ...rest }
  if ('brand' in view) view.brand = withoutBrandContact(view.brand, ownBrandId)
  if (Array.isArray(view.campaign_brands)) {
    view.campaign_brands = view.campaign_brands.map(row =>
      row && typeof row === 'object' && 'brand' in row
        ? { ...(row as Obj), brand: withoutBrandContact((row as Obj).brand, ownBrandId) }
        : row)
  }
  if (Array.isArray(view.campaign_influencers)) view.campaign_influencers = view.campaign_influencers.map(participantForBrand)
  return view as T
}
