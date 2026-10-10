import { NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { resolveBrandPlanAccess } from '@/lib/plan-limits'
import { hasBrandPermission, resolveBrandAccess, type BrandAccess } from '@/lib/supabase/ensureOrg'
import { normalizeWhatsappPhone } from '@/lib/brands/contact'

const BRAND_FIELDS = `
  id, name, logo_url, logo_path, website, instagram, industry, rut,
  contact_name, contact_email, contact_phone,
  address_street, address_number, address_city, address_region, address_country,
  address_place_id, address_lat, address_lng,
  address2_street, address2_number, address2_city, address2_region, address2_country,
  organization_id, user_id, status
`

// FIX (2026-07-10, multiusuario por marca): antes resolvía la marca solo por
// `brands.user_id = user.id` (owner). Ahora resuelve por resolveBrandAccess
// (owner o miembro activo de brand_members) — ver spec Pri "Opción A".
async function getBrandAccess(): Promise<
  { access: BrandAccess; error: null } | { access: null; error: 'Unauthorized' | 'Forbidden' }
> {
  const supabase = createServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { access: null, error: 'Unauthorized' }
  const access = await resolveBrandAccess(user.id)
  if (!access) return { access: null, error: 'Forbidden' }

  return { access, error: null }
}

// GET /api/brand/me — perfil completo de la marca
export async function GET() {
  const { access, error: authErr } = await getBrandAccess()
  if (!access) return NextResponse.json({ error: authErr }, { status: authErr === 'Unauthorized' ? 401 : 403 })
  if (!hasBrandPermission(access, 'brand.read')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('brands')
    .select(BRAND_FIELDS)
    .eq('id', access.brandId)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })

  // Plan y acceso desde la fuente única: override administrativo o
  // suscripción de MARCA activa (nunca una de influencer).
  const planAccess = await resolveBrandPlanAccess(admin, data.id)
  return NextResponse.json({
    data: {
      ...data,
      org_plan: planAccess.plan,
      has_active_subscription: planAccess.hasActiveAccess,
      member_role: access.role,
      is_owner: access.isOwner,
    },
  })
}

// PATCH /api/brand/me — actualizar perfil completo
// Editar el perfil de la marca queda reservado a owner y brand_manager — los
// roles finance/member tienen acceso de lectura (campañas, billing) pero no
// deberían poder cambiar los datos públicos/legales de la marca.
export async function PATCH(request: Request) {
  const { access, error: authErr } = await getBrandAccess()
  if (!access) return NextResponse.json({ error: authErr }, { status: authErr === 'Unauthorized' ? 401 : 403 })
  if (!hasBrandPermission(access, 'brand.manage')) {
    return NextResponse.json({ error: 'No tienes permiso para editar el perfil de la marca' }, { status: 403 })
  }

  const body = await request.json()
  const {
    name, website, instagram, industry, rut,
    contact_name, contact_email, contact_phone,
    address_street, address_number, address_city, address_region, address_country,
    address_place_id, address_lat, address_lng,
    address2_street, address2_number, address2_city, address2_region, address2_country,
  } = body

  const admin = createAdminClient()

  // Instagram obligatorio en el portal marca (mismo criterio que influencer:
  // se valida el estado FINAL resultante, existente + lo que llega en este
  // PATCH, para que no se pueda vaciar el campo). Ver el gate en
  // (brand)/layout.tsx, que redirige a /brand-settings/organization si falta.
  const { data: existingBrand } = await admin
    .from('brands')
    .select('instagram, contact_phone')
    .eq('id', access.brandId)
    .single()
  const finalInstagram = 'instagram' in body
    ? String(instagram ?? '').trim()
    : String(existingBrand?.instagram ?? '').trim()
  if (!finalInstagram) {
    return NextResponse.json({ error: 'Instagram es obligatorio para usar el portal de marca' }, { status: 400 })
  }

  // WhatsApp obligatorio (brands.contact_phone). Mismo criterio: se valida el
  // estado FINAL, así una marca existente sin teléfono puede editar otros
  // datos solo si lo completa, y nadie puede vaciarlo.
  const finalWhatsapp = 'contact_phone' in body
    ? contact_phone
    : existingBrand?.contact_phone
  const normalizedWhatsapp = normalizeWhatsappPhone(finalWhatsapp)
  if (!normalizedWhatsapp) {
    return NextResponse.json(
      { error: 'WhatsApp es obligatorio, con código de país (ej. +56 9 1234 5678)' },
      { status: 400 },
    )
  }

  const requiredLegalFields = [
    ['RUT', rut],
    ['calle', address_street],
    ['comuna', address_city],
    ['región', address_region],
    ['país', address_country],
  ] as const
  const missingLegalField = requiredLegalFields.find(([, value]) => !String(value ?? '').trim())
  if (missingLegalField) {
    return NextResponse.json({ error: `${missingLegalField[0]} es obligatorio para la organización` }, { status: 400 })
  }

  const { data, error } = await admin
    .from('brands')
    .update({
      name,
      website:          website          || null,
      instagram:        instagram        || null,
      industry:         industry         || null,
      rut:              rut              || null,
      contact_name:     contact_name     || null,
      contact_email:    contact_email    || null,
      contact_phone:    normalizedWhatsapp,
      address_street:   address_street   || null,
      address_number:   address_number   || null,
      address_city:     address_city     || null,
      address_region:   address_region   || null,
      address_country:  address_country  || null,
      address_place_id: address_place_id || null,
      address_lat:      address_lat      ?? null,
      address_lng:      address_lng      ?? null,
      address2_street:  address2_street  || null,
      address2_number:  address2_number  || null,
      address2_city:    address2_city    || null,
      address2_region:  address2_region  || null,
      address2_country: address2_country || null,
    })
    .eq('id', access.brandId)
    .select(BRAND_FIELDS)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}
