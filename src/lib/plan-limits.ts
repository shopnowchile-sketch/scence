/**
 * plan-limits.ts
 * Fuente de verdad de límites internos por plan de marca en SCENCE.
 *
 * Fuente de plan (en orden de prioridad):
 *   1. subscriptions.status IN ('active','trialing') → subscription_plans.tier
 *   2. brands.subscription_plan_override = 'free'
 *   3. Sin acceso operativo
 *
 * Mapping de valores a tier:
 *   'free' | null | '' | 'starter' | 'basic'   → basic  (límites; no implica acceso)
 *   'growth'                                     → growth
 *   'pro' | 'plus' | 'enterprise'               → pro    (sin límite práctico)
 *
 * El cobro recurrente se procesa mediante Mercado Pago.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// ── Tipos ─────────────────────────────────────────────────────────────────────

export const PLAN_TIERS = ['basic', 'growth', 'pro'] as const
export type PlanTier = (typeof PLAN_TIERS)[number]
export const PLAN_OVERRIDE_VALUES = ['free', ...PLAN_TIERS] as const
export type BrandPlan = (typeof PLAN_OVERRIDE_VALUES)[number]

export interface PlanLimits {
  label: string
  price_monthly_clp: number
  max_active_campaigns: number    // campañas en status != completed/canceled
  max_roster_influencers: number  // influencers únicos sumados en todas las campañas de la marca
  can_create_open_campaigns: boolean
  can_access_marketplace: boolean
  can_view_full_influencer_base: boolean  // ver TODO el catálogo SCENCE (no solo las relacionadas)
}

// ── Definición de planes ──────────────────────────────────────────────────────

export const PLAN_LIMITS = {
  basic: {
    label:                     'Basic',
    price_monthly_clp:         67_000,
    max_active_campaigns:      1,
    max_roster_influencers:    5,
    can_create_open_campaigns: false,
    can_access_marketplace:    false,
    can_view_full_influencer_base: false,  // Basic: solo influencers relacionadas
  },
  growth: {
    label:                     'Growth',
    price_monthly_clp:         497_000,
    max_active_campaigns:      999,
    max_roster_influencers:    50,
    can_create_open_campaigns: true,
    can_access_marketplace:    false,
    can_view_full_influencer_base: false,  // Growth: NO base completa (solo campañas públicas + postulantes)
  },
  pro: {
    label:                     'Pro',
    price_monthly_clp:         697_000,
    max_active_campaigns:      999,
    max_roster_influencers:    999,
    can_create_open_campaigns: true,
    can_access_marketplace:    true,
    can_view_full_influencer_base: true,   // Pro: base completa
  },
} as const satisfies Record<PlanTier, PlanLimits>

// ── Helper principal ──────────────────────────────────────────────────────────

/**
 * Devuelve los límites del plan a partir de organizations.subscription_plan.
 * Normaliza valores legacy ('starter', 'plus', 'enterprise', 'free', null).
 */
export function getPlanLimits(orgPlan: string | null | undefined): PlanLimits {
  const p = (orgPlan ?? '').toLowerCase().trim()
  if (p === 'growth')                          return PLAN_LIMITS.growth
  if (p === 'pro' || p === 'plus' || p === 'enterprise') return PLAN_LIMITS.pro
  return PLAN_LIMITS.basic  // 'free' | '' | null | 'starter' | 'basic' | desconocido
}

/** Tier canónico desde el valor del campo DB (para UI). */
export function getPlanTier(orgPlan: string | null | undefined): PlanTier {
  const p = (orgPlan ?? '').toLowerCase().trim()
  if (p === 'growth')                                    return 'growth'
  if (p === 'pro' || p === 'plus' || p === 'enterprise') return 'pro'
  return 'basic'
}

/** Free es un acceso interno asignado por SCENCE; nunca genera cobros. */
export function isFreePlan(orgPlan: string | null | undefined): boolean {
  return (orgPlan ?? '').toLowerCase().trim() === 'free'
}

/** Un portal operativo requiere suscripción pagada activa o Free administrativo. */
export function hasBrandPlanAccess(orgPlan: string | null | undefined): boolean {
  const plan = (orgPlan ?? '').toLowerCase().trim()
  return (PLAN_OVERRIDE_VALUES as readonly string[]).includes(plan)
}

/** Formatea precio CLP. Ej: "$99.000" */
export function formatPriceCLP(amount: number): string {
  return `$${amount.toLocaleString('es-CL')}`
}

// ── Resolución de plan activo (backend) ──────────────────────────────────────

/**
 * Resuelve el plan efectivo de una org consultando la fuente correcta:
 *   1. subscriptions activa/trialing → subscription_plans.tier
 *   2. Fallback: organizations.subscription_plan
 *
 * Devuelve un string normalizable por getPlanTier/getPlanLimits.
 * Solo para uso en rutas de API (server-side con admin client).
 */
export async function resolveBrandPlan(
  admin: SupabaseClient,
  organizationId: string,
  brandId?: string | null,
): Promise<string> {
  // 1. Una suscripción financiera activa siempre prevalece sobre cortesías.
  const { data: sub } = await admin
    .from('subscriptions')
    .select('status, plan:subscription_plans(tier)')
    .eq('organization_id', organizationId)
    .in('status', ['active', 'trialing'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const tier = (sub?.plan as { tier?: string } | null)?.tier
  if (tier) return tier

  // 2. Free manual individual de la marca, con vencimiento opcional.
  if (brandId) {
    const { data: brand } = await admin
      .from('brands')
      .select('subscription_plan_override, subscription_plan_override_expires_at')
      .eq('id', brandId)
      .maybeSingle()

    const overrideExpiresAt = brand?.subscription_plan_override_expires_at
    const overrideIsCurrent = !overrideExpiresAt || new Date(overrideExpiresAt).getTime() > Date.now()
    if (overrideIsCurrent && brand?.subscription_plan_override === 'free') return 'free'
  }

  // El campo histórico organizations.subscription_plan no concede acceso:
  // puede quedar desactualizado después de una cancelación. Solo una
  // suscripción activa o el override Free administrativo habilitan el portal.
  return ''
}

// ── Códigos de error para respuestas API ──────────────────────────────────────

export const PLAN_ERROR_CODES = {
  CAMPAIGN_LIMIT:   'PLAN_LIMIT_CAMPAIGNS',
  ROSTER_LIMIT:     'PLAN_LIMIT_ROSTER',
  VISIBILITY_LIMIT: 'PLAN_LIMIT_VISIBILITY',
  INFLUENCER_BASE:  'PLAN_LIMIT_INFLUENCER_BASE',
} as const

/**
 * Regla centralizada: ¿este plan puede ver TODA la base de influencers SCENCE
 * (marketplace/catálogo completo) o solo las relacionadas a sus campañas?
 * Solo Pro puede ver la base completa. Basic y Growth ven únicamente su roster y postulantes.
 */
export function canViewFullInfluencerBase(orgPlan: string | null | undefined): boolean {
  return getPlanLimits(orgPlan).can_view_full_influencer_base
}

export function fullInfluencerBaseMessage(orgPlan: string | null | undefined): string {
  const limits = getPlanLimits(orgPlan)
  return `Tu plan ${limits.label} no incluye el catálogo completo de influencers. Publica una campaña pública para recibir postulaciones, o sube a Pro para explorar toda la base e invitar directamente.`
}

// ── Mensajes de error estandarizados ─────────────────────────────────────────

export function campaignLimitMessage(orgPlan: string | null | undefined): string {
  const limits = getPlanLimits(orgPlan)
  const n = limits.max_active_campaigns
  return `Tu plan ${limits.label} permite máximo ${n} campaña${n !== 1 ? 's' : ''} activa${n !== 1 ? 's' : ''}. Actualiza tu plan para crear más.`
}

export function rosterLimitMessage(orgPlan: string | null | undefined): string {
  const limits = getPlanLimits(orgPlan)
  const n = limits.max_roster_influencers
  return `Tu plan ${limits.label} permite máximo ${n} influencer${n !== 1 ? 's' : ''} en tu roster. Actualiza tu plan para agregar más.`
}

export function visibilityLimitMessage(orgPlan: string | null | undefined): string {
  const limits = getPlanLimits(orgPlan)
  return `Tu primera campaña pública ya fue utilizada. En tu plan ${limits.label} puedes seguir creando campañas privadas con tus creadoras invitadas. Sube de plan para publicar nuevas campañas abiertas al marketplace.`
}
