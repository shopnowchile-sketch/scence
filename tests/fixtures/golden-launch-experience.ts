// GOLDEN CASE — datos de TESTING aprobados por la fundadora (2026-09-24).
// Son fixtures: NO son configuración comercial y no deben copiarse a src/.
// Solo "Superior" tiene valores comerciales reales; Bronze y Premium usan
// valores de relleno hasta que el Admin configure los planes reales.

export const GOLDEN_CAMPAIGN = {
  name: 'SCENCE Launch Experience',
  event: {
    name: 'SCENCE Launch Experience',
    date: '2026-11-14',
    startTime: '18:00',
    location: 'Centro Parque — Bar VRAVA',
  },
} as const

export const GOLDEN_BRAND = {
  name: 'CACHANTUN / CCU',
  instagram: 'cachantun',
  collaborationAccount: '@cachantun',
} as const

// Input tal como lo enviaría el editor Admin (sin ids: los asigna el servidor).
export const GOLDEN_PLANS_INPUT = [
  {
    name: 'Bronze',
    description: 'Fixture de relleno',
    price: 100000,
    currency: 'CLP',
    display_order: 1,
    benefits: ['Presencia de marca en el evento'],
    stand_included: false,
    brand_brief_included: false,
    influencer_content_included: false,
    collaboration_included: false,
  },
  {
    name: 'Premium',
    description: 'Fixture de relleno',
    price: 350000,
    currency: 'CLP',
    display_order: 2,
    benefits: ['Presencia de marca en el evento', 'Integración en la experiencia'],
    stand_included: true,
    brand_brief_included: true,
    influencer_content_included: false,
    collaboration_included: false,
  },
  {
    name: 'Superior',
    description: 'Plan de activación de marca con stand, brief y Collab',
    price: 750000,
    currency: 'CLP',
    display_order: 3,
    benefits: ['Presencia de marca en el evento', 'Integración en la experiencia'],
    influencer_minimum: 10,
    influencer_minimum_label: '10+',
    stand_included: true,
    brand_brief_included: true,
    influencer_content_included: true,
    collaboration_included: true,
    additional_terms: '',
    internal_notes: 'Nota interna: precio negociado con CCU — no mostrar a la marca',
  },
]
