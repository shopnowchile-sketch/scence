// Resuelve los hechos de autorización de una factura (admin, marca, acceso
// compartido) y delega la decisión en decideInvoiceAccess. Usado por TODAS las
// rutas de facturas: no duplicar este criterio en cada ruta.
import type { SupabaseClient } from '@supabase/supabase-js'
import { isPlatformAdmin, resolveBrandAccess } from '@/lib/supabase/ensureOrg'
import { brandStatusAllows } from '@/lib/brand-status-access'
import { decideInvoiceAccess, type InvoiceCapabilities } from '@/lib/invoice-access'

export type InvoiceActorContext = {
  isPlatformAdmin: boolean
  brand: Awaited<ReturnType<typeof resolveBrandAccess>>
}

/** Admin de plataforma y acceso de marca, una sola vez por request. */
export async function resolveInvoiceActor(userId: string, admin: SupabaseClient): Promise<InvoiceActorContext> {
  const platformAdmin = await isPlatformAdmin(userId, admin)
  const brand = platformAdmin ? null : await resolveBrandAccess(userId)
  // Las facturas son facturación: pendiente, aprobada y suspendida pueden verlas; rechazada no.
  return { isPlatformAdmin: platformAdmin, brand: brand && brandStatusAllows(brand.status, 'billing') ? brand : null }
}

export async function hasActiveInvoiceShare(admin: SupabaseClient, invoiceId: string, brandId: string): Promise<boolean> {
  const { data, error } = await admin
    .from('invoice_shares')
    .select('id')
    .eq('invoice_id', invoiceId)
    .eq('brand_id', brandId)
    .eq('status', 'active')
    .maybeSingle()
  // Falla cerrado: si no se puede verificar, no hay acceso compartido.
  if (error) {
    console.error('[invoice access] no se pudo verificar el acceso compartido:', error.message)
    return false
  }
  return !!data
}

export async function authorizeInvoice(
  admin: SupabaseClient,
  actor: InvoiceActorContext,
  invoice: { id: string; owner_brand_id: string | null },
): Promise<InvoiceCapabilities> {
  const brand = actor.brand ? { brandId: actor.brand.brandId, role: actor.brand.role } : null
  const isOwner = brand !== null && invoice.owner_brand_id !== null && brand.brandId === invoice.owner_brand_id
  const shareActive = !actor.isPlatformAdmin && brand !== null && !isOwner
    ? await hasActiveInvoiceShare(admin, invoice.id, brand.brandId)
    : false
  return decideInvoiceAccess({
    isPlatformAdmin: actor.isPlatformAdmin,
    brand,
    ownerBrandId: invoice.owner_brand_id,
    shareActive,
    brandCanManage: actor.brand ? brandStatusAllows(actor.brand.status, 'billing_manage') : false,
  })
}
