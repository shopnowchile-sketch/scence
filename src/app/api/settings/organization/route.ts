import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { ADMIN_ROLES, hasBrandPermission, resolveBrandAccess } from '@/lib/supabase/ensureOrg'

/**
 * Columnas de `organizations` que esta ruta puede devolver. NUNCA `select('*')`:
 * la tabla guarda `google_access_token`, `google_refresh_token`, ids de Stripe y
 * `settings`, que no deben llegar al navegador de ningún rol.
 */
const ORGANIZATION_PUBLIC_COLUMNS =
  'id, name, slug, logo_url, website, industry, country, tax_id, billing_email, currency, is_active, created_at, updated_at'

/**
 * Quién puede tocar la organización (2026-10-22). Falla CERRADO: sin una relación verificable no hay acceso.
 *  - Administración de SCENCE (membresía activa `super_admin`): opera sobre una de SUS membresías. Si tiene
 *    más de una hay que indicar `?organization_id=`; nunca se elige «la primera» ni «la más antigua».
 *  - Usuario de marca: solo la organización de SU marca, con el permiso pedido y el estado que lo permita
 *    (hasBrandPermission). Un `organization_id` ajeno se rechaza.
 *  - Cualquier otro caso (sin membresía, influencer, acceso de marca no resuelto): 403. Ya no existe la
 *    organización predeterminada como alternativa (antes getOrgId la devolvía y se omitía el permiso).
 */
async function resolveOrgAccess(
  userId: string,
  admin: ReturnType<typeof createAdminClient>,
  permission: 'brand.read' | 'brand.manage',
  requestedOrgId: string | null,
): Promise<{ orgId: string } | { error: string; status: 403 | 409; organizations?: Array<{ id: string; name: string }> }> {
  const { data: adminRows } = await admin
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', userId)
    .eq('is_active', true)
    .in('role', ADMIN_ROLES)
  const adminOrgIds = Array.from(new Set((adminRows ?? []).map((r: { organization_id: string }) => r.organization_id)))

  if (adminOrgIds.length > 0) {
    if (requestedOrgId) {
      return adminOrgIds.includes(requestedOrgId) ? { orgId: requestedOrgId } : { error: 'Forbidden', status: 403 }
    }
    if (adminOrgIds.length === 1) return { orgId: adminOrgIds[0] }
    // Nunca se elige una al azar: se devuelve la lista (solo id y nombre de SUS organizaciones) para que la pantalla pida elegir.
    const { data: choices } = await admin.from('organizations').select('id, name').in('id', adminOrgIds)
    return { error: 'Tienes más de una organización de administración: elige una (organization_id)', status: 409, organizations: (choices ?? []).map((o: { id: string; name: string }) => ({ id: o.id, name: o.name })) }
  }

  const brandAccess = await resolveBrandAccess(userId)
  if (!brandAccess || !hasBrandPermission(brandAccess, permission)) return { error: 'Forbidden', status: 403 }
  if (requestedOrgId && requestedOrgId !== brandAccess.organizationId) return { error: 'Forbidden', status: 403 }
  return { orgId: brandAccess.organizationId }
}

const requestedOrg = (request: NextRequest) => new URL(request.url).searchParams.get('organization_id')

// ── GET /api/settings/organization ───────────────────────────────────────────
export async function GET(request: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const access = await resolveOrgAccess(user.id, admin, 'brand.read', requestedOrg(request))
  if ('error' in access) return NextResponse.json({ error: access.error, ...(access.organizations ? { code: 'ORGANIZATION_SELECTION_REQUIRED', organizations: access.organizations } : {}) }, { status: access.status })
  const orgId = access.orgId

  const { data, error } = await admin
    .from('organizations')
    .select(ORGANIZATION_PUBLIC_COLUMNS)
    .eq('id', orgId)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}

// ── PATCH /api/settings/organization ─────────────────────────────────────────
export async function PATCH(request: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const access = await resolveOrgAccess(user.id, admin, 'brand.manage', requestedOrg(request))
  if ('error' in access) return NextResponse.json({ error: access.error, ...(access.organizations ? { code: 'ORGANIZATION_SELECTION_REQUIRED', organizations: access.organizations } : {}) }, { status: access.status })
  const orgId = access.orgId

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { name, website, industry, country, billing_email, currency, tax_id, logo_url } = body

  const { data, error } = await admin
    .from('organizations')
    .update({
      name:          name          ?? undefined,
      website:       website       ?? null,
      industry:      industry      ?? null,
      country:       country       ?? undefined,
      billing_email: billing_email ?? null,
      currency:      currency      ?? undefined,
      tax_id:        tax_id        ?? null,
      logo_url:      logo_url      ?? null,
      updated_at:    new Date().toISOString(),
    })
    .eq('id', orgId)
    .select(ORGANIZATION_PUBLIC_COLUMNS)
    .single()

  if (error) { console.error('[PATCH /api/settings/organization]', error); return NextResponse.json({ error: error.message }, { status: 500 }) }
  return NextResponse.json({ data })
}
