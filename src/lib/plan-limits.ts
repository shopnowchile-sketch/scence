/**
 * plan-limits.ts
 * Fuente de verdad de límites internos por plan de marca en SCENCE.
 *
 * Fuente de plan (en orden de prioridad):
 *   1. brands.subscription_plan_override
 *   2. subscriptions.status IN ('active','trialing') → subscription_plans.tier
 *   3. organizations.subscription_plan
 *   4. Basic como fallback
 *
 * Mapping de valores a tier:
 *   'free' | null | '' | 'starter' | 'basic'   → basic  (más restrictivo)
 *   'growth'                                     → growth
 *   'pro' | 'plus' | 'enterprise'               → pro    (sin límite práctico)
 *
 * El cobro recurrente se procesa mediante Mercado Pago.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// ── Tipos ─────────────────────────────────────────────────────────────────────

export const PLAN_TIERS = ['basic', 'growth', 'pro'] as const
export type PlanTier = (typeof PLAN_TIERS)[number]

export interface PlanLimits {
  label: string
  price_monthly_clp: number
  max_active_campaigns: number
  max_roster_influencers: number
  can_create_open_campaigns: boolean
  can_access_marketplace: boolean
  can_view_full_influencer_base: boolean
}

// ── Definición de planes ──────────────────────────────────────────────────────

export const PLAN_LIMITS = {
  basic: {
    label:                     'Starter',
    price_monthly_clp:         67_000,
    max_active_campaigns:      1,
    max_roster_influencers:    5,
    can_create_open_campaigns: false,
    can_access_marketplace:    false,
    can_view_full_influencer_base: false,
  },
  growth: {
    label:                     'Growth',
    price_monthly_clp:         267_000,
    max_active_campaigns:      999,
    max_roster_influencers:    50,
    can_create_open_campaigns: true,
    can_access_marketplace:    false,
    can_view_full_influencer_base: false,
  },
  pro: {
    label:                     'Pro',
    price_monthly_clp:         697_000,
    max_active_campaigns:      999,
    max_roster_influencers:    999,
    can_create_open_campaigns: true,
    can_access_marketplace:    true,
    can_view_full_influencer_base: true,
  },
} as const satisfies Record<PlanTier, PlanLimits>

export function getPlanLimits(orgPlan: string | null | undefined): PlanLimits {
  const p = (orgPlan ?? '').toLowerCase().trim()
  if (p === 'growth') return PLAN_LIMITS.growth
  if (p === 'pro' || p === 'plus' || p === 'enterprise') return PLAN_LIMITS.pro
  return PLAN_LIMITS.basic
}

export function getPlanTier(orgPlan: string | null | undefined): PlanTier {
  const p = (orgPlan ?? '').toLowerCase().trim()
  if (p === 'growth') return 'growth'
  if (p === 'pro' || p === 'plus' || p === 'enterprise') return 'pro'
  return 'basic'
}

export function formatPriceCLP(amount: number): string {
  return `$${amount.toLocaleString('es-CL')}`
}

export async function resolveBrandPlan(
  admin: SupabaseClient,
  organizationId: string,
  brandId?: string | null,
): Promise<string> {
  if (brandId) {
    const { data: brand } = await admin
      .from('brands')
      .select('subscription_plan_override')
      .eq('id', brandId)
      .maybeSingle()

    const override = brand?.subscription_plan_override
    if (typeof override === 'string' && (PLAN_TIERS as readonly string[]).includes(override)) {
      return override
    }
  }

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

  const { data: org } = await admin
    .from('organizations')
    .select('subscription_plan')
    .eq('id', organizationId)
    .single()

  return org?.subscription_plan ?? 'basic'
}

export const PLAN_ERROR_CODES = {
  CAMPAIGN_LIMIT:   'PLAN_LIMIT_CAMPAIGNS',
  ROSTER_LIMIT:     'PLAN_LIMIT_ROSTER',
  VISIBILITY_LIMIT: 'PLAN_LIMIT_VISIBILITY',
  INFLUENCER_BASE:  'PLAN_LIMIT_INFLUENCER_BASE',
} as const

export function canViewFullInfluencerBase(orgPlan: string | null | undefined): boolean {
  return getPlanLimits(orgPlan).can_view_full_influencer_base
}

export function fullInfluencerBaseMessage(orgPlan: string | null | undefined): string {
  const limits = getPlanLimits(orgPlan)
  return `Tu plan ${limits.label} no incluye el catálogo completo de influencers. Publica una campaña pública para recibir postulaciones, o sube a Pro para explorar toda la base e invitar directamente.`
}

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
