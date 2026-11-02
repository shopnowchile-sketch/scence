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
