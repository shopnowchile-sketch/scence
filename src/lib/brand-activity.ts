import type { SupabaseClient } from '@supabase/supabase-js'
import type { BrandAccess } from '@/lib/supabase/ensureOrg'

export const BRAND_ACTIVITY_LABELS = {
  dashboard: 'Abrió el inicio',
  campaigns: 'Abrió sus campañas',
  campaign: 'Abrió una campaña',
  campaignNew: 'Abrió el formulario de campaña',
  campaignEdit: 'Abrió la edición de una campaña',
  campaignInvite: 'Abrió las invitaciones de una campaña',
  campaignReport: 'Abrió el reporte de una campaña',
  influencers: 'Abrió Influencers',
  influencer: 'Abrió una ficha de influencer',
  ranking: 'Abrió el ranking',
  brands: 'Abrió Marcas',
  opportunities: 'Abrió Oportunidades',
  billing: 'Abrió Facturación',
  documents: 'Abrió Documentos',
  settings: 'Abrió Configuración',
  plan: 'Abrió Planes',
  users: 'Abrió Usuarios',
  locations: 'Abrió Lugares',
  support: 'Abrió Soporte',
  campaignCreated: 'Creó una campaña',
  campaignUpdated: 'Editó una campaña',
  campaignSubmitted: 'Envió una campaña a aprobación',
  applicationAccepted: 'Aprobó una postulación',
  applicationsRejected: 'Rechazó postulaciones o retiró invitaciones',
  profileUpdated: 'Actualizó el perfil de la marca',
} as const

type Activity = keyof typeof BRAND_ACTIVITY_LABELS
const RECORD_ID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/

export function brandSection(path: string): Activity | null {
  if (path.length > 180 || !/^\/[a-z0-9/-]+$/.test(path)) return null
  const [section, item, tab, extra] = path.slice(1).split('/')
  if (extra !== undefined) return null
  switch (section) {
    case 'brand-dash': return item === undefined ? 'dashboard' : null
    case 'brand-campaigns':
      if (!item) return 'campaigns'
      if (item === 'new' && !tab) return 'campaignNew'
      if (!RECORD_ID.test(item)) return null
      if (!tab) return 'campaign'
      if (tab === 'edit') return 'campaignEdit'
      if (tab === 'invite') return 'campaignInvite'
      if (tab === 'report') return 'campaignReport'
      return null
    case 'brand-influencers':
      if (tab !== undefined) return null
      if (item === 'ranking') return 'ranking'
      if (!item || item === 'new') return 'influencers'
      return RECORD_ID.test(item) ? 'influencer' : null
    case 'brand-settings':
      if (tab !== undefined) return null
      if (item === 'plan') return 'plan'
      if (item === 'users') return 'users'
      if (item === 'locations') return 'locations'
      return !item || ['organization', 'profile', 'notifications'].includes(item) ? 'settings' : null
    case 'brand-brands': return item === undefined ? 'brands' : null
    case 'brand-opportunities': return item === undefined ? 'opportunities' : null
    case 'brand-billing': return item === undefined ? 'billing' : null
    case 'brand-documents': return item === undefined ? 'documents' : null
    case 'brand-profile': return item === undefined ? 'settings' : null
    case 'brand-support': return item === undefined ? 'support' : null
    default: return null
  }
}

export async function recordBrandActivity(
  admin: SupabaseClient,
  access: BrandAccess,
  actorId: string,
  activity: Activity,
  campaignName?: string,
): Promise<void> {
  try {
    const { error } = await admin.from('audit_logs').insert({
      actor_id: actorId,
      organization_id: access.organizationId,
      action: `brand_portal.${activity}`,
      entity_type: 'brand',
      entity_id: access.brandId,
      changes: campaignName ? { campaign_name: campaignName } : {},
    })
    if (error) console.error('[brand activity]', error.code)
  } catch (error) {
    console.error('[brand activity]', error instanceof Error ? error.name : 'unknown')
  }
}
