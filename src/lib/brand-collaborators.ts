/**
 * Marcas colaboradoras persistentes (M5). Relación DIRECCIONAL A → B: no crea la
 * inversa, no da acceso a campañas, influencers ni datos privados de B.
 *
 * Quién puede qué (decisión de la fundadora, 2026-10-23):
 *   - super_admin (admin de plataforma): leer y modificar la lista de cualquier marca.
 *   - owner de la marca: agregar y quitar (permiso existente `team.manage`, solo owner).
 *   - resto de roles de la marca: solo consultar la lista de SU marca (`brand.read`).
 * Todo exige que la marca esté `approved` (capacidad `operate`): el servidor lo aplica.
 */
export type CollaboratorAction = 'read' | 'manage'

export type CollaboratorAccessInput = {
  isPlatformAdmin: boolean
  /**
   * `canRead` / `canManage` los calcula la ruta con la fuente canónica
   * `hasBrandPermission(access, 'brand.read' | 'team.manage', 'operate')`
   * (rol + estado de la marca). Aquí no se reimplementa esa lógica.
   */
  access: { brandId: string; canRead: boolean; canManage: boolean } | null
  action: CollaboratorAction
  /** brand_id pedido por el cliente (query/body). Nunca se confía en él para marcas. */
  requestedBrandId: string | null
}

export type CollaboratorAccessDecision =
  | { ok: true; brandId: string; actor: 'platform_admin' | 'brand' }
  | { ok: false; status: 403 | 422; error: string }

export function decideCollaboratorAccess(input: CollaboratorAccessInput): CollaboratorAccessDecision {
  if (input.isPlatformAdmin) {
    if (!input.requestedBrandId) return { ok: false, status: 422, error: 'brand_id requerido' }
    return { ok: true, brandId: input.requestedBrandId, actor: 'platform_admin' }
  }
  const { access } = input
  if (!access) return { ok: false, status: 403, error: 'Forbidden' }
  // La marca sale de la sesión; un brand_id ajeno en el payload se rechaza.
  if (input.requestedBrandId && input.requestedBrandId !== access.brandId) {
    return { ok: false, status: 403, error: 'Forbidden' }
  }
  if (!(input.action === 'manage' ? access.canManage : access.canRead)) {
    return { ok: false, status: 403, error: 'Forbidden' }
  }
  return { ok: true, brandId: access.brandId, actor: 'brand' }
}

/**
 * Únicos campos de la marca colaboradora que se exponen (nada privado). Nunca
 * incluye `status`: el estado de aprobación es interno de SCENCE y no se revela a
 * otras marcas (CLAUDE.md §16.9, aislamiento).
 */
export const COLLABORATOR_BRAND_FIELDS = 'id, name, logo_url, instagram'

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
