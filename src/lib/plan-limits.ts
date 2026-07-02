/**
 * plan-limits.ts
 * Fuente de verdad de límites internos por plan de marca en SCENCE.
 *
 * Fuente de plan (en orden de prioridad):
 *   1. subscriptions.status IN ('active','trialing') → subscription_plans.tier
 *   2. Fallback: organizations.subscription_plan (TEXT, DEFAULT 'free')
 *
 * Mapping de valores a tier:
 *   'free' | null | '' | 'starter' | 'basic'   → basic  (más restrictivo)
 *   'growth'                                     → growth
 *   'pro' | 'plus' | 'enterprise'               → pro    (sin límite práctico)
 *
 * Sin Stripe, sin billing real — solo gating interno.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// ── Tipos ─────────────────────────────────────────────────────────────────────

export const PLAN_TIERS = ['basic', 'growth', 'pro'] as const
export type PlanTier = (typeof PLAN_TIERS)[number]

export interface PlanLimits {
  label: string
  price_monthly_clp: number
  max_active_campaigns: number    // campañas en status != completed/canceled
  max_roster_influencers: number  // influencers únicos sumados en todas las campañas de la marca
  can_create_open_campaigns: boolean
  can_access_marketplace: boolean
}

// ── Definición de planes ──────────────────────────────────────────────────────

export const PLAN_LIMITS = {
  basic: {
    label:                     'Basic',
    price_monthly_clp:         99_000,
    max_active_campaigns:      1,
    max_roster_influencers:    3,
    can_create_open_campaigns: false,
    can_access_marketplace:    false,
  },
  growth: {
    label:                     'Growth',
    price_monthly_clp:         259_000,
    max_active_campaigns:      5,
    max_roster_influencers:    25,
    can_create_open_campaigns: false,
    can_access_marketplace:    false,
  },
  pro: {
    label:                     'Pro',
    price_monthly_clp:         699_000,
    max_active_campaigns:      999,
    max_roster_influencers:    999,
    can_create_open_campaigns: true,
    can_access_marketplace:    true,
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
): Promise<string> {
  // 1. Intentar suscripción activa/trialing con su tier
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

  // 2. Fallback a organizations.subscription_plan
  const { data: org } = await admin
    .from('organizations')
    .select('subscription_plan')
    .eq('id', organizationId)
    .single()

  return org?.subscription_plan ?? 'free'
}

// ── Códigos de error para respuestas API ──────────────────────────────────────

export const PLAN_ERROR_CODES = {
  CAMPAIGN_LIMIT:   'PLAN_LIMIT_CAMPAIGNS',
  ROSTER_LIMIT:     'PLAN_LIMIT_ROSTER',
  VISIBILITY_LIMIT: 'PLAN_LIMIT_VISIBILITY',
} as const

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
  return `Tu plan ${limits.label} no permite campañas abiertas (postulaciones). Actualiza a Pro para habilitarlas.`
}
