import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId, getUserRole, hasBrandPermission, resolveBrandAccess, type BrandPermission } from '@/lib/supabase/ensureOrg'
import { readEcommerceLinks, validateEcommerceLinks } from '@/lib/brand-ecommerce'

type Params = { params: { id: string } }

// Puntos de venta de una marca: tiendas físicas = public.locations (level='place', brand_id) y canales
// e-commerce = enlaces en brands.metadata. brand_locations ya no existe.

async function canAccessBrand(userId: string, userMetadata: Record<string, unknown> | undefined, brandId: string, admin: ReturnType<typeof createAdminClient>, permission: BrandPermission) {
  const orgId = await getOrgId(userId, userMetadata, admin)
  const role = orgId ? await getUserRole(userId, orgId, admin) : null
  if (role?.isAdmin) return true
  const brandAccess = await resolveBrandAccess(userId)
  return brandAccess?.brandId === brandId && hasBrandPermission(brandAccess, permission)
}

async function authorize(permission: BrandPermission, brandId: string) {
  const supabase = createServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const admin = createAdminClient()
  const { data: brand } = await admin.from('brands').select('id, metadata').eq('id', brandId).maybeSingle()
  if (!brand) return { res: NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 }) }
  if (!(await canAccessBrand(user.id, user.user_metadata, brandId, admin, permission))) {
    return { res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { admin, brand }
}

// GET → puntos de venta físicos (con geografía) + e-commerce de la marca.
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await authorize('location.read', params.id)
  if ('res' in auth) return auth.res
  const { admin, brand } = auth

  const { data, error } = await admin
    .from('locations')
    .select('id, name, address, type, notes')
    .eq('level', 'place').eq('brand_id', params.id).eq('is_active', true)
    .neq('type', 'influencer_home')
    .order('name')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const places = await Promise.all((data ?? []).map(async place => {
    const { data: breadcrumb } = await admin.rpc('location_breadcrumb', { p_id: place.id })
    const byLevel = (level: string) => (breadcrumb ?? []).find((i: { level: string; name: string }) => i.level === level)?.name ?? null
    return { ...place, city: byLevel('commune'), region: byLevel('region'), country: byLevel('country') }
  }))
  return NextResponse.json({ data: places, ecommerce: readEcommerceLinks(brand.metadata) })
}

// PUT { ecommerce: [{ name, url }] } → reemplaza los enlaces e-commerce (conserva el resto de metadata).
export async function PUT(req: NextRequest, { params }: Params) {
  const auth = await authorize('location.manage', params.id)
  if ('res' in auth) return auth.res
  const { admin, brand } = auth

  const body = await req.json().catch(() => null)
  const parsed = validateEcommerceLinks(body?.ecommerce)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 })

  const base = brand.metadata && typeof brand.metadata === 'object' && !Array.isArray(brand.metadata) ? brand.metadata : {}
  const { error } = await admin.from('brands').update({ metadata: { ...base, ecommerce_links: parsed.value } }).eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ecommerce: parsed.value })
}
