import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { hasBrandPermission, isPlatformAdmin, resolveBrandAccess } from '@/lib/supabase/ensureOrg'
import { normalizeInstagramHandle } from '@/lib/brands/instagram'
import {
  COLLABORATOR_BRAND_FIELDS,
  UUID_RE,
  decideCollaboratorAccess,
  type CollaboratorAction,
} from '@/lib/brand-collaborators'

// Marcas colaboradoras persistentes (M5). Relación direccional A → B en
// `brand_collaborators`; no concede acceso a campañas, influencers ni datos de B.
// Solo vincula marcas YA existentes y APROBADAS por Instagram normalizado. Una
// marca inexistente o no aprobada se trata igual (404): no se revela su existencia
// ni su estado interno. Crear marcas nuevas desde aquí está deshabilitado hasta
// resolver la dependencia con `register_brand` (M3): no se importa
// registerBrandAtomic a propósito.

type Authorized = { admin: ReturnType<typeof createAdminClient>; userId: string; brandId: string }

async function authorize(
  action: CollaboratorAction,
  requestedBrandId: string | null,
): Promise<Authorized | NextResponse> {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (requestedBrandId && !UUID_RE.test(requestedBrandId)) {
    return NextResponse.json({ error: 'brand_id inválido' }, { status: 422 })
  }

  const admin = createAdminClient()
  const platformAdmin = await isPlatformAdmin(user.id, admin)
  const access = platformAdmin ? null : await resolveBrandAccess(user.id)
  const decision = decideCollaboratorAccess({
    isPlatformAdmin: platformAdmin,
    // Rol Y estado de la marca (solo `approved` opera). team.manage = solo owner.
    access: access && {
      brandId: access.brandId,
      canRead: hasBrandPermission(access, 'brand.read', 'operate'),
      canManage: hasBrandPermission(access, 'team.manage', 'operate'),
    },
    action,
    requestedBrandId,
  })
  if (!decision.ok) return NextResponse.json({ error: decision.error }, { status: decision.status })

  if (decision.actor === 'platform_admin') {
    const { data: brand } = await admin.from('brands').select('id').eq('id', decision.brandId).maybeSingle()
    if (!brand) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })
  }
  return { admin, userId: user.id, brandId: decision.brandId }
}

// GET /api/brand/collaborators[?brand_id=] — lista de colaboradoras de la marca.
export async function GET(req: NextRequest) {
  const auth = await authorize('read', req.nextUrl.searchParams.get('brand_id'))
  if (auth instanceof NextResponse) return auth

  const { data: rows, error } = await auth.admin
    .from('brand_collaborators')
    .select('collaborator_brand_id, created_at')
    .eq('brand_id', auth.brandId)
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const ids = (rows ?? []).map(r => r.collaborator_brand_id as string)
  if (!ids.length) return NextResponse.json({ data: [] })

  const { data: brands, error: brandsError } = await auth.admin
    .from('brands')
    .select(COLLABORATOR_BRAND_FIELDS)
    .in('id', ids)
  if (brandsError) return NextResponse.json({ error: brandsError.message }, { status: 500 })

  const byId = new Map((brands ?? []).map(b => [b.id as string, b]))
  const data = (rows ?? [])
    .map(r => ({ added_at: r.created_at, brand: byId.get(r.collaborator_brand_id as string) ?? null }))
    .filter(r => r.brand)
  return NextResponse.json({ data })
}

// POST /api/brand/collaborators  { instagram, brand_id? } — agrega una marca EXISTENTE.
export async function POST(req: NextRequest) {
  let body: { instagram?: unknown; brand_id?: unknown } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  // `null` es JSON válido pero no un objeto: sin esto, body.brand_id lanzaría un TypeError (500) antes de autenticar.
  if (body === null) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  const auth = await authorize('manage', typeof body.brand_id === 'string' ? body.brand_id : null)
  if (auth instanceof NextResponse) return auth

  const instagram = normalizeInstagramHandle(body.instagram)
  if (!instagram) {
    return NextResponse.json({ error: 'Instagram inválido. Usa @usuario o una URL de Instagram.' }, { status: 422 })
  }

  // Solo marcas `approved` (el estado se filtra en la consulta y nunca se devuelve).
  // limit(2): si hubiera más de una aprobada, no se elige ni se fusiona (409).
  const { data: matches, error: lookupError } = await auth.admin
    .from('brands')
    .select(COLLABORATOR_BRAND_FIELDS)
    .eq('instagram_handle_normalized', instagram)
    .eq('status', 'approved')
    .limit(2)
  if (lookupError) return NextResponse.json({ error: lookupError.message }, { status: 500 })
  if ((matches?.length ?? 0) > 1) {
    return NextResponse.json({ error: 'Instagram ambiguo: requiere revisión manual de SCENCE', code: 'ambiguous_instagram' }, { status: 409 })
  }
  const target = matches?.[0]
  if (!target) {
    return NextResponse.json({
      error: 'No se encontró una marca con ese Instagram. Crear marcas nuevas desde aquí aún no está habilitado.',
      code: 'brand_not_found_creation_disabled',
    }, { status: 404 })
  }
  if (target.id === auth.brandId) {
    return NextResponse.json({ error: 'Una marca no puede ser colaboradora de sí misma' }, { status: 422 })
  }

  const { error: insertError } = await auth.admin
    .from('brand_collaborators')
    .insert({ brand_id: auth.brandId, collaborator_brand_id: target.id, created_by: auth.userId })
  // 23505 = la relación ya existe (repetición o solicitud simultánea): idempotente.
  if (insertError && insertError.code !== '23505') {
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }
  return NextResponse.json({ data: { brand: target }, created: !insertError }, { status: insertError ? 200 : 201 })
}

// DELETE /api/brand/collaborators?collaborator_brand_id=&brand_id= — quita la relación A → B.
export async function DELETE(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const collaboratorId = params.get('collaborator_brand_id')
  if (!collaboratorId || !UUID_RE.test(collaboratorId)) {
    return NextResponse.json({ error: 'collaborator_brand_id requerido' }, { status: 422 })
  }
  const auth = await authorize('manage', params.get('brand_id'))
  if (auth instanceof NextResponse) return auth

  const { error } = await auth.admin
    .from('brand_collaborators')
    .delete()
    .eq('brand_id', auth.brandId)
    .eq('collaborator_brand_id', collaboratorId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
