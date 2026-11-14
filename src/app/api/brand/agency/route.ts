import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import {
  AGENCY_ACTIVE_BRAND_COOKIE, AGENCY_COMMITMENT_MONTHS, AGENCY_PLAN_PRICE_USD, brandHasCurrentSubscription,
  listAgencyBrands, resolveAgencyBrandAccess, resolveAgencyContext,
} from '@/lib/agency-brands'

// GET /api/brand/agency — marcas que administra la agencia del usuario y su mensualidad.
// Para quien no es agencia responde { is_agency: false } (sin revelar nada más).
export async function GET() {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const agency = await resolveAgencyContext(admin, user.id)
  if (!agency) return NextResponse.json({ is_agency: false })

  const brands = await listAgencyBrands(admin, agency.organizationId)
  const withPlan = await Promise.all(brands.map(async brand => ({
    id: brand.id,
    name: brand.name,
    status: brand.status,
    is_agency_own: brand.organization_id === agency.organizationId,
    subscription_current: await brandHasCurrentSubscription(admin, brand.id),
  })))
  let activeBrandId: string | null = null
  try {
    const { cookies } = await import('next/headers')
    const cookieValue = cookies().get(AGENCY_ACTIVE_BRAND_COOKIE)?.value ?? null
    activeBrandId = withPlan.find(brand => brand.id === cookieValue)?.id ?? null
  } catch { /* sin cookie */ }
  return NextResponse.json({
    is_agency: true,
    active_brand_id: activeBrandId ?? withPlan.find(brand => brand.is_agency_own)?.id ?? null,
    plan: { price_usd: AGENCY_PLAN_PRICE_USD, commitment_months: AGENCY_COMMITMENT_MONTHS },
    brands: withPlan,
  })
}

// POST /api/brand/agency { brand_id } — elige la marca activa. Solo marcas del alcance de la agencia.
export async function POST(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: { brand_id?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const brandId = typeof body.brand_id === 'string' ? body.brand_id : ''
  const access = brandId ? await resolveAgencyBrandAccess(createAdminClient(), user.id, brandId) : null
  // Misma respuesta si la marca no existe o no es de la agencia: no se revela existencia.
  if (!access) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })
  const response = NextResponse.json({ active_brand_id: access.brandId })
  response.cookies.set(AGENCY_ACTIVE_BRAND_COOKIE, access.brandId, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 * 30 })
  return response
}
