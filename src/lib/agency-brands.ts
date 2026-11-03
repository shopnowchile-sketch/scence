import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeBrandRole } from '@/lib/brand-permissions'
import { brandSubscriptionGrantsAccess } from '@/lib/plan-limits'

/**
 * Agencia multimarca (Impulso Consulting). Excepción acotada a CLAUDE.md §16.9:
 * solo el OWNER activo de una organización marcada `settings.agency_portal = true`
 * administra las marcas que esa agencia registró (`brands.metadata.managed_by_org_id`)
 * más la propia marca de la agencia. Nadie más gana permisos: no se crean
 * membresías sobre las marcas administradas y la marca activa se valida siempre
 * en el servidor contra esta relación.
 */

export const AGENCY_ACTIVE_BRAND_COOKIE = 'scence_active_brand'
export const AGENCY_PLAN_TIER = 'agency'
export const AGENCY_PLAN_PRICE_CLP = 69_900
export const AGENCY_COMMITMENT_MONTHS = 3
/** PayPal manda el estado con retraso: el período no se considera vencido hasta pasada esta gracia, solo si PayPal sigue diciendo ACTIVE. */
export const AGENCY_PERIOD_GRACE_MS = 48 * 60 * 60 * 1000

export type AgencyContext = { organizationId: string; userId: string }

export type AgencyBrandRow = {
  id: string
  name: string | null
  status: string | null
  organization_id: string
  metadata: Record<string, unknown> | null
}

const BRAND_SELECT = 'id, name, status, organization_id, metadata'

export function isAgencySettings(settings: unknown): boolean {
  return (settings as { agency_portal?: unknown } | null | undefined)?.agency_portal === true
}

/** Agencia que administra el usuario: owner activo con rol de marca en una org `agency_portal`. */
export async function resolveAgencyContext(admin: SupabaseClient, userId: string): Promise<AgencyContext | null> {
  const { data: memberships } = await admin
    .from('organization_members')
    .select('organization_id, role, is_owner')
    .eq('user_id', userId)
    .eq('is_active', true)
    .eq('is_owner', true)
    .in('role', ['brand_manager', 'member'])
  const orgIds = Array.from(new Set((memberships ?? []).map(m => m.organization_id as string)))
  if (orgIds.length === 0) return null
  const { data: orgs } = await admin.from('organizations').select('id, settings').in('id', orgIds)
  const agency = (orgs ?? []).find(o => isAgencySettings(o.settings))
  return agency ? { organizationId: agency.id as string, userId } : null
}

/** ¿La marca pertenece al alcance de la agencia (propia o registrada por ella)? */
export function brandInAgencyScope(brand: Pick<AgencyBrandRow, 'organization_id' | 'metadata'> | null, agencyOrgId: string): boolean {
  if (!brand) return false
  if (brand.organization_id === agencyOrgId) return true
  return brand.metadata?.managed_by_org_id === agencyOrgId
}

export async function listAgencyBrands(admin: SupabaseClient, agencyOrgId: string): Promise<AgencyBrandRow[]> {
  const [own, managed] = await Promise.all([
    admin.from('brands').select(BRAND_SELECT).eq('organization_id', agencyOrgId),
    admin.from('brands').select(BRAND_SELECT).eq('metadata->>managed_by_org_id', agencyOrgId),
  ])
  if (own.error) throw new Error(`No se pudieron leer las marcas de la agencia: ${own.error.message}`)
  if (managed.error) throw new Error(`No se pudieron leer las marcas administradas: ${managed.error.message}`)
  const byId = new Map<string, AgencyBrandRow>()
  for (const row of [...(own.data ?? []), ...(managed.data ?? [])] as AgencyBrandRow[]) byId.set(row.id, row)
  return Array.from(byId.values()).sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), 'es'))
}

/** Acceso de gestión (rol dueño de marca) a UNA marca del alcance de la agencia; null si no corresponde. */
export async function resolveAgencyBrandAccess(admin: SupabaseClient, userId: string, brandId: string) {
  const ctx = await resolveAgencyContext(admin, userId)
  if (!ctx) return null
  const { data: brand } = await admin.from('brands').select(BRAND_SELECT).eq('id', brandId).maybeSingle()
  if (!brand || !brandInAgencyScope(brand as AgencyBrandRow, ctx.organizationId)) return null
  return {
    brandId: brand.id as string,
    organizationId: brand.organization_id as string,
    role: normalizeBrandRole('brand_manager', true),
    isOwner: true,
    status: (brand.status as string | null) ?? null,
  }
}

/** Marca activa elegida (cookie): solo se respeta si la agencia la administra. */
export async function activeAgencyBrandAccess(admin: SupabaseClient, userId: string, cookieBrandId: string | null | undefined) {
  if (!cookieBrandId) return null
  return resolveAgencyBrandAccess(admin, userId, cookieBrandId)
}

// ── Mensualidad por marca ────────────────────────────────────────────────────

/** ¿Esta marca queda sujeta a la regla de mensualidad de agencia? (marca de la agencia o administrada por ella) */
export async function isAgencyScopedBrand(admin: SupabaseClient, brandId: string): Promise<boolean> {
  const { data: brand } = await admin.from('brands').select(BRAND_SELECT).eq('id', brandId).maybeSingle()
  if (!brand) return false
  if (typeof brand.metadata?.managed_by_org_id === 'string') return true
  const { data: org } = await admin.from('organizations').select('settings').eq('id', brand.organization_id).maybeSingle()
  return isAgencySettings(org?.settings)
}

type SubscriptionRow = {
  id: string
  status: string
  current_period_end: string | null
  metadata: unknown
  paypal_subscription_id: string | null
  plan: { tier?: string | null } | { tier?: string | null }[] | null
}

const planTier = (row: SubscriptionRow) => (Array.isArray(row.plan) ? row.plan[0]?.tier : row.plan?.tier) ?? null

/**
 * Suscripción vigente de ESA marca (regla para TODAS las marcas, decisión 2026-11-03: se paga al enviar a
 * aprobación, no al entrar). Cuenta una suscripción de la organización propia de la marca (nunca de otra):
 * la mensualidad `agency` (activa o con período pagado futuro) o un plan Basic/Growth/Pro existente con acceso.
 * Un override administrativo (otorgado por un admin) también habilita.
 */
export function agencyMonthIsCurrent(rows: SubscriptionRow[], override: unknown, now: number = Date.now()): boolean {
  if (typeof override === 'string' && override.trim()) return true
  return rows.some(row => {
    // Suscripciones existentes (Basic/Growth/Pro) siguen valiendo con su regla de siempre: no se les pide pagar de nuevo.
    if (planTier(row) !== AGENCY_PLAN_TIER) {
      return brandSubscriptionGrantsAccess({ status: row.status, current_period_end: row.current_period_end, metadata: row.metadata }, now)
    }
    if (!brandSubscriptionGrantsAccess({ status: row.status, current_period_end: row.current_period_end, metadata: row.metadata }, now)) return false
    const end = row.current_period_end ? Date.parse(row.current_period_end) : NaN
    if (!Number.isFinite(end)) return false
    return row.status === 'canceled' ? end > now : end + AGENCY_PERIOD_GRACE_MS > now
  })
}

export async function brandHasCurrentSubscription(admin: SupabaseClient, brandId: string, now: number = Date.now()): Promise<boolean> {
  const { data: brand } = await admin.from('brands').select('id, organization_id, subscription_plan_override').eq('id', brandId).maybeSingle()
  if (!brand?.organization_id) return false
  const { data, error } = await admin
    .from('subscriptions')
    .select('id, status, current_period_end, metadata, paypal_subscription_id, plan:subscription_plans(tier)')
    .eq('organization_id', brand.organization_id)
  if (error) throw new Error(`No se pudo leer la suscripción de la marca: ${error.message}`)
  // Cada suscripción queda atada a su marca: una fila con otro brand_id nunca habilita.
  const own = ((data ?? []) as unknown as SubscriptionRow[]).filter(row => {
    const linked = (row.metadata as { brand_id?: unknown } | null)?.brand_id
    return linked === undefined || linked === null || linked === brandId
  })
  return agencyMonthIsCurrent(own, brand.subscription_plan_override, now)
}

export const AGENCY_SUBSCRIPTION_REQUIRED = 'AGENCY_SUBSCRIPTION_REQUIRED'
