// Nichos prioritarios de prospección. Se guardan como valor de `crm_leads.source`
// — no hay columna nueva: `source` ya es filtrable en la UI del CRM ("base de
// datos"). Esta lista solo estandariza los valores para los leads NUEVOS; la
// base histórica conserva sus fuentes originales (sii_*, maturana_*, etc.).
export const CRM_NICHE_SOURCES = [
  'nicho_restaurantes',
  'nicho_comida',
  'nicho_experiencias',
  'nicho_belleza',
  'nicho_wellness',
  'nicho_shopify',
  'nicho_ecommerce',
  'nicho_multisucursal',
  'nicho_hoteles_turismo',
  'nicho_eventos',
  'nicho_moda_deporte',
] as const

export type CrmNicheSource = (typeof CRM_NICHE_SOURCES)[number]
