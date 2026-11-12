import { recordBrandActivity } from '@/lib/brand-activity'
import { NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { resolveBrandPlanAccess } from '@/lib/plan-limits'
import { hasBrandPermission, resolveBrandAccess, type BrandAccess } from '@/lib/supabase/ensureOrg'
import { isAgencyScopedBrand } from '@/lib/agency-brands'
import { PROFILE_LEGAL_SELECT, missingCompanyLegalFields } from '@/lib/brand-legal-profile'
import { buildBrandProfileUpdate, mergeLegalState } from '@/lib/brand-profile-update'

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
  { access: BrandAccess; userId: string; error: null } | { access: null; userId: null; error: 'Unauthorized' | 'Forbidden' }
> {
  const supabase = createServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { access: null, userId: null, error: 'Unauthorized' }
  const access = await resolveBrandAccess(user.id)
  if (!access) return { access: null, userId: null, error: 'Forbidden' }

  return { access, userId: user.id, error: null }
}

// GET /api/brand/me — perfil completo de la marca
export async function GET() {
  const { access, userId, error: authErr } = await getBrandAccess()
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
  // Representante legal (owner): fuente única profiles.user_name / signer_rut / signer_role. Solo lo ve su propio owner.
  const { data: representative } = access.isOwner && userId
    ? await admin.from('profiles').select(PROFILE_LEGAL_SELECT).eq('user_id', userId).maybeSingle()
    : { data: null }
  return NextResponse.json({
    data: {
      ...data,
      representative: access.isOwner ? {
        user_name: representative?.user_name ?? '', signer_rut: representative?.signer_rut ?? '', signer_role: representative?.signer_role ?? '',
      } : null,
      org_plan: planAccess.plan,
      agency_managed: await isAgencyScopedBrand(admin, data.id),
      has_active_subscription: planAccess.hasActiveAccess,
      member_role: access.role,
      is_owner: access.isOwner,
      nda_signed: access.ndaSigned === true,
    },
  })
}

// PATCH /api/brand/me — actualizar perfil completo
// Editar el perfil de la marca queda reservado a owner y brand_manager — los
// roles finance/member tienen acceso de lectura (campañas, billing) pero no
// deberían poder cambiar los datos públicos/legales de la marca.
export async function PATCH(request: Request) {
  const { access, userId, error: authErr } = await getBrandAccess()
  if (!access) return NextResponse.json({ error: authErr }, { status: authErr === 'Unauthorized' ? 401 : 403 })
  if (!hasBrandPermission(access, 'brand.manage')) {
    return NextResponse.json({ error: 'No tienes permiso para editar el perfil de la marca' }, { status: 403 })
  }

  const body = await request.json()
  const { representative } = body

  const admin = createAdminClient()

  // Instagram obligatorio en el portal marca (mismo criterio que influencer:
  // se valida el estado FINAL resultante, existente + lo que llega en este
  // PATCH, para que no se pueda vaciar el campo). Ver el gate en
  // (brand)/layout.tsx, que redirige a /brand-settings/organization si falta.
  const { data: existingBrand } = await admin
    .from('brands')
    .select('instagram, rut, address_street, address_city, address_region, address_country')
    .eq('id', access.brandId)
    .single()
  // Actualización parcial: solo se escribe lo que llega; la validación usa el estado final (guardado + enviado).
  const brandUpdate = buildBrandProfileUpdate(body)
  const finalState = mergeLegalState(existingBrand, brandUpdate) as Record<string, string | null | undefined>
  const finalInstagram = String(finalState.instagram ?? '').trim()
  if (!finalInstagram) {
    return NextResponse.json({ error: 'Instagram es obligatorio para usar el portal de marca' }, { status: 400 })
  }

  // Reglas legales de la empresa: fuente única en lib/brand-legal-profile.ts.
  const missingLegalField = missingCompanyLegalFields(finalState)[0]
  if (missingLegalField) {
    return NextResponse.json({ error: `${missingLegalField.label} es obligatorio para la organización` }, { status: 400 })
  }

  // Representante legal (solo el owner): se guarda en su perfil, que es la fuente de verdad. Se valida antes de
  // escribir la marca para no dejar una actualización a medias.
  let representativeUpdate: Record<string, string> | null = null
  if (representative && typeof representative === 'object') {
    if (!access.isOwner || !userId) return NextResponse.json({ error: 'Solo el owner puede editar al representante legal' }, { status: 403 })
    const rep = representative as Record<string, unknown>
    representativeUpdate = {}
    for (const key of ['user_name', 'signer_rut', 'signer_role'] as const) {
      if (key in rep) representativeUpdate[key] = String(rep[key] ?? '').trim()
    }
    if ('user_name' in representativeUpdate && !representativeUpdate.user_name) {
      return NextResponse.json({ error: 'El nombre del representante legal no puede quedar vacío' }, { status: 400 })
    }
  }

  const { data, error } = await admin
    .from('brands')
    .update(brandUpdate)
    .eq('id', access.brandId)
    .select(BRAND_FIELDS)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (representativeUpdate && Object.keys(representativeUpdate).length > 0 && userId) {
    const { error: profileError } = await admin.from('profiles')
      .update({ ...representativeUpdate, updated_at: new Date().toISOString() }).eq('user_id', userId)
    if (profileError) return NextResponse.json({ error: `Se guardó la empresa, pero no el representante legal: ${profileError.message}` }, { status: 500 })
  }
  await recordBrandActivity(admin, access, userId, 'profileUpdated')
  return NextResponse.json({ data })
}
