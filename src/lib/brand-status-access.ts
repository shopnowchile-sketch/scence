import type { BrandPermission } from './brand-permissions.ts'

/**
 * Qué puede hacer una marca según su estado (decisión de la fundadora,
 * 2026-10-22; CLAUDE.md §16.9). El servidor aplica la regla; la interfaz solo
 * la refleja.
 *
 *   pending_approval  completar perfil, ver estado, hacer los pasos de
 *                     aprobación (incluye elegir plan y firmar documentos
 *                     legales) y CONSULTAR su facturación. Sin emitir ni
 *                     modificar documentos financieros y sin funciones
 *                     operativas (decisión 2026-10-22).
 *   approved          lo que permitan su rol y su plan.
 *   rejected          ver el resultado. Sin funciones operativas.
 *   suspended         operaciones bloqueadas; solo facturación para resolver
 *                     la suspensión u obligaciones pendientes.
 *
 * Un estado desconocido o ausente falla cerrado (solo `status`).
 */
export type BrandStatus = 'pending_approval' | 'approved' | 'rejected' | 'suspended'
export type BrandCapability = 'status' | 'profile' | 'onboarding' | 'billing' | 'billing_manage' | 'operate'

export const BRAND_STATUSES: readonly BrandStatus[] = ['pending_approval', 'approved', 'rejected', 'suspended']

const ALLOWED: Record<BrandStatus, ReadonlySet<BrandCapability>> = {
  pending_approval: new Set<BrandCapability>(['status', 'profile', 'onboarding', 'billing']),
  approved: new Set<BrandCapability>(['status', 'profile', 'onboarding', 'billing', 'billing_manage', 'operate']),
  rejected: new Set<BrandCapability>(['status']),
  // Suspendida: puede consultar y gestionar su facturación para resolver obligaciones.
  suspended: new Set<BrandCapability>(['status', 'billing', 'billing_manage']),
}

export function isBrandStatus(value: unknown): value is BrandStatus {
  return typeof value === 'string' && (BRAND_STATUSES as readonly string[]).includes(value)
}

export function brandStatusAllows(status: string | null | undefined, capability: BrandCapability): boolean {
  if (!isBrandStatus(status)) return capability === 'status'
  return ALLOWED[status].has(capability)
}

/** Capacidad de estado que exige cada permiso de rol. Todo lo no listado es operación. */
export function capabilityForPermission(permission: BrandPermission): BrandCapability {
  switch (permission) {
    case 'brand.read':
      return 'status'
    case 'brand.manage':
      return 'profile'
    case 'billing.read':
    case 'financial_document.read':
      return 'billing'
    case 'billing.manage':
    case 'financial_document.manage':
      return 'billing_manage'
    case 'legal_document.read':
    case 'legal_document.manage':
      return 'onboarding'
    default:
      return 'operate'
  }
}

/**
 * Páginas del portal de marca que una marca `pending_approval` puede abrir (decisión 2026-10-26): completar el perfil
 * de la marca y el personal (datos para firmar), consultar su facturación, completar los documentos permitidos y
 * elegir plan. Todo lo demás (campañas, influencers, reportes) sigue bloqueado hasta la aprobación. Es solo la
 * experiencia de navegación: el servidor aplica la misma regla en cada ruta (`brandStatusAllows`).
 */
const PENDING_BRAND_PORTAL_PATHS = [
  '/brand-settings/organization',
  '/brand-settings/profile',
  '/brand-settings/plan',
  '/brand-billing',
  '/brand-documents',
] as const

export function pendingBrandPathAllowed(pathname: string): boolean {
  return PENDING_BRAND_PORTAL_PATHS.some(path => pathname === path || pathname.startsWith(`${path}/`))
}
