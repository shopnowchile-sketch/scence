/**
 * plan-limits.ts
 * Fuente de verdad de límites internos por plan de marca en SCENCE.
 *
 * Fuente de plan (en orden de prioridad) — ver resolveBrandPlanAccess():
 *   1. brands.subscription_plan_override (otorgado manualmente por un admin)
 *   2. suscripción de MARCA active/trialing de la org de la marca
 *      (nunca una suscripción de influencer)
 *   3. Basic
 *
 * Mapping de valores a tier:
 *   'free' | null | '' | 'starter' | 'basic'   → basic  (más restrictivo)
 *   'growth'                                     → growth
 *   'pro' | 'plus' | 'enterprise'               → pro    (sin límite práctico)
 *
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
  can_view_full_influencer_base: boolean  // ver TODO el catálogo SCENCE (no solo las relacionadas)
}

// ── Definición de planes ──────────────────────────────────────────────────────

export const PLAN_LIMITS = {
  basic: {
    label:                     'Basic',
    price_monthly_clp:         150_000,  // SCORE · Pymes (IVA incluido). Primer mes: BRAND_PLAN_INTRO_CLP.
    max_active_campaigns:      1,
    max_roster_influencers:    5,
    can_create_open_campaigns: true,     // SCORE: Pymes publica campañas abiertas; el tope es 1 campaña activa a la vez
    can_access_marketplace:    false,
    can_view_full_influencer_base: false,  // Basic: solo influencers relacionadas
  },
  growth: {
    label:                     'Growth',
    price_monthly_clp:         250_000,  // SCORE · Marcas / Pymes con gestión (IVA incluido)
    max_active_campaigns:      999,
    max_roster_influencers:    50,
    can_create_open_campaigns: true,
    can_access_marketplace:    false,
    can_view_full_influencer_base: false,  // Growth: NO base completa (solo campañas públicas + postulantes)
  },
  pro: {
    label:                     'Pro',
    price_monthly_clp:         699_000,
    max_active_campaigns:      999,
    max_roster_influencers:    999,
    can_create_open_campaigns: true,
    can_access_marketplace:    true,
    can_view_full_influencer_base: true,   // Pro: base completa
  },
} as const satisfies Record<PlanTier, PlanLimits>

// ── Helper principal ──────────────────────────────────────────────────────────

/**
 * Devuelve los límites de un valor de plan (tier o valor legacy).
 * Normaliza valores legacy ('starter', 'plus', 'enterprise', 'free', null).
 */
export function getPlanLimits(orgPlan: string | null | undefined): PlanLimits {
  const p = (orgPlan ?? '').toLowerCase().trim()
  if (p === 'growth' || p === 'agency')        return PLAN_LIMITS.growth  // 'agency' = mensualidad por marca de agencia (campañas ilimitadas)
  if (p === 'pro' || p === 'plus' || p === 'enterprise') return PLAN_LIMITS.pro
  return PLAN_LIMITS.basic  // 'free' | '' | null | 'starter' | 'basic' | desconocido
}

/** Tier canónico desde el valor del campo DB (para UI). */
export function getPlanTier(orgPlan: string | null | undefined): PlanTier {
  const p = (orgPlan ?? '').toLowerCase().trim()
  if (p === 'growth' || p === 'agency')                  return 'growth'
  if (p === 'pro' || p === 'plus' || p === 'enterprise') return 'pro'
  return 'basic'
}

/** Formatea precio CLP. Ej: "$99.000" */
export function formatPriceCLP(amount: number): string {
  return `$${amount.toLocaleString('es-CL')}`
}

// ── Precio comercial Brand (USD, PayPal) ─────────────────────────────────────

/**
 * Precio comercial de los planes de marca: lo que se muestra en el botón de
 * PayPal y en el email de confirmación. Única definición en código.
 * (El monto que PayPal cobra lo fija cada PAYPAL_*_PLAN_ID en PayPal.)
 */
// SCORE (2026-11): los precios CLP incluyen IVA y son la referencia comercial; PayPal cobra un monto fijo en USD.
// Los USD de basic/growth son PROVISIONALES (referencia $930 CLP/USD) hasta fijar los planes de PayPal Live.
// launchMonths = meses al precio de entrada (0 = sin precio de entrada). `pro` ya no se vende: conserva sus valores.
export const BRAND_PLAN_USD_PRICING = {
  basic:  { launch: 75,  launchMonths: 1, regular: 161 },
  growth: { launch: 269, launchMonths: 0, regular: 269 },
  pro:    { launch: 749, launchMonths: 3, regular: 1011.15 },
} as const satisfies Record<PlanTier, { launch: number; launchMonths: number; regular: number }>

/** Planes de marca a la venta. `pro` queda solo para los accesos ya otorgados (no se contrata de nuevo). */
export const BRAND_PLANS_FOR_SALE: readonly PlanTier[] = ['basic', 'growth']

/** Nombre comercial SCORE de cada plan (pantalla de planes y correos). El `label` interno no cambia. */
export const BRAND_PLAN_COMMERCIAL_NAME = { basic: 'Pymes', growth: 'Marcas', pro: 'Pro' } as const satisfies Record<PlanTier, string>

/** Precio de entrada en CLP (IVA incluido) del primer mes, por plan. */
export const BRAND_PLAN_INTRO_CLP: Partial<Record<PlanTier, number>> = { basic: 70_000 }

/** Aviso único de moneda: referencia en CLP, cobro fijo en USD. */
export const PRICE_FX_NOTICE = 'Precios de referencia en CLP con IVA incluido. PayPal cobra un monto fijo en USD; el valor final en pesos puede variar según el tipo de cambio.'

// Modalidad comercial del plan de $250.000 (mismo plan técnico `growth`): 'managed' = Pymes con gestión,
// 'training' = Marcas con entrenamiento. Vive en brands.metadata.service_mode y solo la escribe un admin.
export const BRAND_SERVICE_MODES = ['managed', 'training'] as const
export type BrandServiceMode = (typeof BRAND_SERVICE_MODES)[number]
export const BRAND_SERVICE_MODE_LABEL = { managed: 'Pymes con gestión', training: 'Marcas con entrenamiento' } as const satisfies Record<BrandServiceMode, string>
export function normalizeServiceMode(value: unknown): BrandServiceMode | null {
  return typeof value === 'string' && (BRAND_SERVICE_MODES as readonly string[]).includes(value) ? value as BrandServiceMode : null
}

/** Texto único del cobro USD de un plan (botón y correos). */
export function brandPlanUsdTerms(tier: PlanTier): string {
  const { launch, launchMonths, regular } = BRAND_PLAN_USD_PRICING[tier]
  const usd = (n: number) => `US$${Number.isInteger(n) ? n : n.toFixed(2)}`
  if (launchMonths <= 0 || launch === regular) return `${usd(regular)}/mes`
  return `${usd(launch)}${launchMonths === 1 ? ' el primer mes' : `/mes durante ${launchMonths} meses`}. Luego ${usd(regular)}/mes`
}

// ── Plan y acceso de marca (backend) — fuente única ──────────────────────────
//
// Regla:
//   1. brands.subscription_plan_override = plan otorgado MANUALMENTE por un admin.
//   2. Suscripción de MARCA de la organización de la marca que da acceso:
//      active/trialing, o canceled con current_period_end futuro (cancelar =
//      no renovar; el período pagado se respeta, igual que Influencer Pro).
//      Una suscripción de influencer (metadata.account_type = 'influencer')
//      jamás cuenta, aunque comparta organización o fila de subscription_plans.
//   3. basic.
// Acceso activo al portal = override administrativo o suscripción de marca que da acceso.

type SubscriptionMetadata = { account_type?: unknown } | null | undefined

/** true si la fila de `subscriptions` pertenece a una influencer (nunca cuenta para marcas). */
export function isInfluencerSubscription(metadata: unknown): boolean {
  return (metadata as SubscriptionMetadata)?.account_type === 'influencer'
}

export function normalizePlanOverride(value: unknown): PlanTier | null {
  return typeof value === 'string' && (PLAN_TIERS as readonly string[]).includes(value) ? value as PlanTier : null
}

export type BrandSubscriptionRow = {
  id: string
  organization_id: string
  status: string
  created_at: string
  current_period_end: string | null
  paypal_subscription_id: string | null
  metadata: unknown
  plan: { tier?: string | null } | null
}

export type BrandPlanAccess = {
  plan: PlanTier
  source: 'override' | 'subscription' | 'none'
  override: PlanTier | null
  subscription: BrandSubscriptionRow | null
  hasActiveAccess: boolean
}

/**
 * ¿Esta suscripción de marca da acceso hoy? active/trialing siempre; canceled
 * solo mientras dure el período pagado. past_due/incomplete nunca.
 * (Misma regla que grantsPro de Influencer Pro, sin compartir código.)
 */
export function brandSubscriptionGrantsAccess(
  subscription: Pick<BrandSubscriptionRow, 'status' | 'current_period_end' | 'metadata'>,
  now: number = Date.now(),
): boolean {
  if (isInfluencerSubscription(subscription.metadata)) return false
  if (subscription.status === 'active' || subscription.status === 'trialing') return true
  return subscription.status === 'canceled'
    && Boolean(subscription.current_period_end)
    && new Date(subscription.current_period_end as string).getTime() > now
}

/** Regla pura: override → suscripción de marca que da acceso → basic. */
export function computeBrandPlanAccess(override: unknown, brandSubscription: BrandSubscriptionRow | null, now: number = Date.now()): BrandPlanAccess {
  const activeBrandSubscription = brandSubscription && brandSubscriptionGrantsAccess(brandSubscription, now) ? brandSubscription : null
  const manual = normalizePlanOverride(override)
  if (manual) {
    return { plan: manual, source: 'override', override: manual, subscription: activeBrandSubscription, hasActiveAccess: true }
  }
  if (activeBrandSubscription) {
    return { plan: getPlanTier(activeBrandSubscription.plan?.tier), source: 'subscription', override: null, subscription: activeBrandSubscription, hasActiveAccess: true }
  }
  return { plan: 'basic', source: 'none', override: null, subscription: null, hasActiveAccess: false }
}

const BRAND_SUBSCRIPTION_SELECT = 'id, organization_id, status, created_at, current_period_end, paypal_subscription_id, metadata, plan:subscription_plans(tier)'

/**
 * Suscripción de MARCA que da acceso, por organización. Prioridad: una
 * active/trialing (la más reciente); si no hay, una canceled con período vigente.
 */
async function loadAccessGrantingBrandSubscriptions(admin: SupabaseClient, organizationIds: string[]) {
  const byOrganization = new Map<string, BrandSubscriptionRow>()
  if (organizationIds.length === 0) return byOrganization
  const { data, error } = await admin
    .from('subscriptions')
    .select(BRAND_SUBSCRIPTION_SELECT)
    .in('organization_id', organizationIds)
    .in('status', ['active', 'trialing', 'canceled'])
    .order('created_at', { ascending: false })
  if (error) throw new Error(`No se pudo leer la suscripción de la marca: ${error.message}`)
  const now = Date.now()
  for (const row of (data ?? []) as unknown as BrandSubscriptionRow[]) {
    if (!brandSubscriptionGrantsAccess(row, now)) continue
    const current = byOrganization.get(row.organization_id)
    const isRenewing = row.status === 'active' || row.status === 'trialing'
    const currentIsRenewing = current?.status === 'active' || current?.status === 'trialing'
    if (!current || (isRenewing && !currentIsRenewing)) byOrganization.set(row.organization_id, row)
  }
  return byOrganization
}

type BrandPlanInput = { id: string; organization_id: string | null; subscription_plan_override?: unknown }

/** Plan y acceso de varias marcas (una sola lectura de suscripciones). */
export async function resolveBrandPlanAccessMany(admin: SupabaseClient, brands: BrandPlanInput[]) {
  const organizationIds = Array.from(new Set(brands.map(b => b.organization_id).filter((id): id is string => Boolean(id))))
  const subscriptions = await loadAccessGrantingBrandSubscriptions(admin, organizationIds)
  return new Map(brands.map(b => [
    b.id,
    computeBrandPlanAccess(b.subscription_plan_override, b.organization_id ? subscriptions.get(b.organization_id) ?? null : null),
  ]))
}

/**
 * Plan y acceso de UNA marca. Siempre usa la organización de la propia marca
 * (nunca la de una campaña: muchas campañas viven en la org de la agencia).
 */
export async function resolveBrandPlanAccess(admin: SupabaseClient, brandId: string): Promise<BrandPlanAccess> {
  const { data: brand, error } = await admin
    .from('brands')
    .select('id, organization_id, subscription_plan_override')
    .eq('id', brandId)
    .maybeSingle()
  if (error) throw new Error(`No se pudo leer la marca: ${error.message}`)
  if (!brand) return computeBrandPlanAccess(null, null)
  return (await resolveBrandPlanAccessMany(admin, [brand])).get(brand.id) ?? computeBrandPlanAccess(null, null)
}

/** Plan efectivo de la marca (basic | growth | pro). */
export async function resolveBrandPlan(admin: SupabaseClient, brandId: string): Promise<PlanTier> {
  return (await resolveBrandPlanAccess(admin, brandId)).plan
}

// ── Códigos de error para respuestas API ──────────────────────────────────────

export const PLAN_ERROR_CODES = {
  CAMPAIGN_LIMIT:   'PLAN_LIMIT_CAMPAIGNS',
  ROSTER_LIMIT:     'PLAN_LIMIT_ROSTER',
  VISIBILITY_LIMIT: 'PLAN_LIMIT_VISIBILITY',
  INFLUENCER_BASE:  'PLAN_LIMIT_INFLUENCER_BASE',
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
  return `Tu plan ${limits.label} permite máximo ${n} influencer${n !== 1 ? 's' : ''} entre aceptadas e invitadas en tus campañas vigentes. Actualiza tu plan para agregar más.`
}

export function visibilityLimitMessage(orgPlan: string | null | undefined): string {
  const limits = getPlanLimits(orgPlan)
  return `Tu plan ${limits.label} no permite publicar más campañas abiertas. Puedes seguir creando campañas privadas con tus creadoras invitadas o subir de plan.`
}
