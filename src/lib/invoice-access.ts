// Autorización de facturas (pagos y datos financieros — Regla Cero).
//
// Fuente única de "quién puede qué sobre ESTA factura". Pura y sin I/O para poder
// probarla; las rutas resuelven los hechos (admin, marca, acceso compartido) y
// solo aplican el resultado. Nunca se autoriza por `organization_id`: la propiedad
// es `invoices.owner_brand_id` (ver migración 20261022120000).
//
//   platform_admin : equipo SCENCE (organization_members.role = super_admin). Todo.
//   owner_brand    : marca propietaria. Según su permiso de facturación: leer,
//                    editar campos no financieros, enviar, marcar pagada, borrar
//                    borradores y compartir. NUNCA void ni mark_overdue.
//   shared_brand   : marca con acceso compartido ACTIVO. Solo lectura.
//   none           : sin acceso. La ruta responde 404 (no revela si existe).
//
// owner_brand_id NULL (emitida por SCENCE o histórica sin propietario verificable):
// ninguna marca coincide, solo el administrador accede.

import { roleHasBrandPermission, type BrandRole } from '@/lib/brand-permissions'

export type InvoiceActor = 'platform_admin' | 'owner_brand' | 'shared_brand' | 'none'

export type InvoiceCapabilities = {
  actor: InvoiceActor
  read: boolean
  edit: boolean
  send: boolean
  markPaid: boolean
  /** void y mark_overdue: exclusivos del equipo SCENCE. */
  voidOrOverdue: boolean
  delete: boolean
  /** Compartir / revocar acceso. Nunca lo tiene una marca con acceso compartido. */
  share: boolean
}

const NO_ACCESS: InvoiceCapabilities = {
  actor: 'none', read: false, edit: false, send: false, markPaid: false,
  voidOrOverdue: false, delete: false, share: false,
}

export type InvoiceAccessInput = {
  isPlatformAdmin: boolean
  /** Acceso de marca verificado en servidor (resolveBrandAccess), o null. */
  brand: { brandId: string; role: BrandRole } | null
  /** invoices.owner_brand_id de la factura consultada. */
  ownerBrandId: string | null
  /** Existe una fila ACTIVA en invoice_shares para (factura, brand.brandId). */
  shareActive: boolean
  /**
   * El estado de la marca permite gestionar facturación (aprobada o suspendida). Una
   * marca pendiente solo consulta. Por defecto true: lo calcula authorizeInvoice.
   */
  brandCanManage?: boolean
}

export function decideInvoiceAccess(input: InvoiceAccessInput): InvoiceCapabilities {
  if (input.isPlatformAdmin) {
    return {
      actor: 'platform_admin', read: true, edit: true, send: true, markPaid: true,
      voidOrOverdue: true, delete: true, share: true,
    }
  }

  const { brand, ownerBrandId } = input
  if (!brand) return NO_ACCESS
  const canRead = roleHasBrandPermission(brand.role, 'billing.read')
  const canManage = roleHasBrandPermission(brand.role, 'billing.manage') && (input.brandCanManage ?? true)

  if (ownerBrandId !== null && brand.brandId === ownerBrandId) {
    if (!canRead) return NO_ACCESS
    return {
      actor: 'owner_brand', read: true, edit: canManage, send: canManage, markPaid: canManage,
      voidOrOverdue: false, delete: canManage, share: canManage,
    }
  }

  // Acceso compartido: solo lectura y solo si la marca puede leer facturación.
  if (input.shareActive && canRead) {
    return {
      actor: 'shared_brand', read: true, edit: false, send: false, markPaid: false,
      voidOrOverdue: false, delete: false, share: false,
    }
  }

  return NO_ACCESS
}

/**
 * Una factura compartida no expone datos internos de la marca propietaria ni de
 * SCENCE (organización, emisor, pasarela, metadata cruda). `client_*` ya viene
 * normalizado por la ruta.
 */
export function redactInvoiceForShare<T extends Record<string, unknown>>(invoice: T): Omit<T, 'organization_id' | 'issued_by' | 'stripe_invoice_id' | 'owner_brand_id' | 'metadata'> {
  const { organization_id: _o, issued_by: _i, stripe_invoice_id: _s, owner_brand_id: _b, metadata: _m, ...rest } = invoice
  return rest
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)
