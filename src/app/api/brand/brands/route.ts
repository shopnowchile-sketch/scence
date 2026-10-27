import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { getOrgId, hasBrandPermission, isPlatformAdmin, resolveBrandAccess } from '@/lib/supabase/ensureOrg'
import { authorizeBrandRegistration, registerBrandAtomic } from '@/lib/supabase/registerBrand'
import { registrationDeniedMessage, registrationKey } from '@/lib/brand-registration-policy'
import { isPlausibleEmail } from '@/lib/email-match'

export async function GET(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  // Quién puede ver el listado: admin de plataforma (su propia organización) o un usuario de marca con `campaign.read`
  // (el listado se arma con las campañas de la marca) y una marca en estado operativo (aprobada). Antes bastaba cualquier membresía.
  const platformAdmin = await isPlatformAdmin(user.id, admin)
  const brandAccess = platformAdmin ? null : await resolveBrandAccess(user.id)
  if (!platformAdmin && (!brandAccess || !hasBrandPermission(brandAccess, 'campaign.read'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  // La organización sale de la marca resuelta (no de «la primera membresía»); el admin usa la suya.
  const orgId = brandAccess ? brandAccess.organizationId : await getOrgId(user.id, user.user_metadata, admin)

  if (!orgId) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 400 })
  }

  const search = req.nextUrl.searchParams.get('search')?.trim().toLowerCase() ?? ''

  const { data: campaigns, error: campaignsError } = await admin
    .from('campaigns')
    .select('id, name')
    .eq('organization_id', orgId)

  if (campaignsError) {
    return NextResponse.json({ error: campaignsError.message }, { status: 500 })
  }

  const campaignIds = (campaigns ?? []).map(c => c.id)

  const collaboratorRows = campaignIds.length
    ? await admin
        .from('campaign_brands')
        .select(`
          brand_id,
          role,
          campaign_id,
          brand:brands(
            id,
            name,
            logo_url,
            instagram,
            industry,
            status,
            created_at,
            created_by
          )
        `)
        .in('campaign_id', campaignIds)
    : { data: [], error: null }

  if (collaboratorRows.error) {
    return NextResponse.json({ error: collaboratorRows.error.message }, { status: 500 })
  }

  const { data: createdBrands, error: createdError } = await admin
    .from('brands')
    .select('id, name, logo_url, instagram, industry, status, created_at, created_by')
    .eq('created_by', user.id)

  if (createdError) {
    return NextResponse.json({ error: createdError.message }, { status: 500 })
  }

  const campaignMap = new Map((campaigns ?? []).map(c => [c.id, c.name]))
  const brandMap = new Map<string, Record<string, unknown>>()

  for (const brand of createdBrands ?? []) {
    brandMap.set(brand.id, {
      ...brand,
      relationship: 'Creada por ti',
      campaigns: [],
    })
  }

  for (const row of collaboratorRows.data ?? []) {
    const brand = Array.isArray(row.brand) ? row.brand[0] : row.brand
    if (!brand) continue

    const current = brandMap.get(brand.id) ?? {
      ...brand,
      relationship: 'Colaboradora',
      campaigns: [],
    }

    const campaignList = Array.isArray(current.campaigns)
      ? current.campaigns
      : []

    const campaignName = campaignMap.get(row.campaign_id)

    if (campaignName && !campaignList.includes(campaignName)) {
      campaignList.push(campaignName)
    }

    brandMap.set(brand.id, {
      ...current,
      campaigns: campaignList,
    })
  }

  let rows = Array.from(brandMap.values())

  if (search) {
    rows = rows.filter(row =>
      String(row.name ?? '').toLowerCase().includes(search)
    )
  }

  rows.sort((a, b) =>
    String(a.name ?? '').localeCompare(String(b.name ?? ''), 'es')
  )

  return NextResponse.json({
    data: rows,
    total: rows.length,
  })
}


export async function POST(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  // Pueden registrar marcas: influencers, usuarios de una marca APROBADA y admins
  // de plataforma, siempre con cuenta verificada y activa. Registrar no concede
  // brand_manager ni acceso a otras marcas (CLAUDE.md §16.9).
  const decision = await authorizeBrandRegistration(admin, user)
  if (!decision.allowed) {
    return NextResponse.json({ error: registrationDeniedMessage(decision.reason) }, { status: 403 })
  }
  const orgId = await getOrgId(user.id, user.user_metadata, admin)

  let body: Record<string, unknown>

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const name = String(body.name ?? '').trim()
  const email = String(body.contact_email ?? '').trim().toLowerCase()
  const instagram = typeof body.instagram === 'string'
    ? body.instagram.trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/\/$/, '') || null
    : null

  if (!name) {
    return NextResponse.json({ error: 'El nombre es obligatorio' }, { status: 422 })
  }

  if (!email) {
    return NextResponse.json(
      { error: 'El email de contacto es obligatorio' },
      { status: 422 }
    )
  }

  if (!isPlausibleEmail(email)) {
    return NextResponse.json({ error: 'El email de contacto no es válido' }, { status: 422 })
  }

  const brandFields = {
    name,
    logo_url: body.logo_url || null,
    website: body.website || null,
    instagram,
    industry: body.industry || null,
    contact_name: body.contact_name || null,
    contact_email: email,
    contact_phone: body.contact_phone || null,
    notes: body.notes || null,
    metadata: {
      created_from_brand_portal: true,
      // Org de la persona que registra (referencia informativa; no es un vínculo marca→marca).
      invited_by_organization_id: orgId,
    },
  }
  const registered = await registerBrandAtomic(admin, {
    brand: brandFields,
    registeredBy: user.id,
    key: registrationKey(user.id, brandFields),
  })
  if (!registered.ok) {
    console.error('[POST /api/brand/brands]', registered.error)
    return NextResponse.json({ error: 'No se pudo registrar la marca' }, { status: 500 })
  }
  if (registered.outcome === 'conflict') {
    // No se revela el nombre ni el id de la marca existente: pertenece a otra
    // organización y las marcas no se ven entre sí.
    return NextResponse.json({ error: 'Ya existe una marca registrada con ese email' }, { status: 409 })
  }

  const { data, error } = await admin.from('brands').select('*').eq('id', registered.brandId).single()
  if (error || !data) return NextResponse.json({ error: 'No se pudo leer la marca registrada' }, { status: 500 })

  return NextResponse.json({ data }, { status: registered.outcome === 'replayed' ? 200 : 201 })
}
