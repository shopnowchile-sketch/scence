import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'
import { resolveBrandPlan } from '@/lib/plan-limits'
import { resolveLastSeen } from '@/lib/supabase/lastSeen'

// ── GET /api/brands ───────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return NextResponse.json({ error: 'Organization not found' }, { status: 400 })

  const sp     = req.nextUrl.searchParams
  const search = sp.get('search')
  const limit  = Number(sp.get('limit') ?? '100')

  // Selectores solo necesitan id y nombre. Evita joins, consultas de sesión,
  // usuarios de Auth y planes por cada marca.
  if (sp.get('options') === '1') {
    let optionsQuery = admin
      .from('brands')
      .select('id, name')
      .order('name', { ascending: true })
      .limit(Math.min(Math.max(limit, 1), 5000))
    if (search) optionsQuery = optionsQuery.ilike('name', `%${search}%`)
    const { data: options, error: optionsError } = await optionsQuery
    if (optionsError) return NextResponse.json({ error: optionsError.message }, { status: 500 })
    return NextResponse.json({ data: options ?? [], total: options?.length ?? 0 })
  }

  // { count: 'exact' } es necesario para que `count` (usado abajo en el
  // `total` de la respuesta) no sea siempre null — sin esto el endpoint
  // decía `total: 0` sin importar cuántas marcas hubiera (bug real: nadie
  // podía haber estado usando `total` de acá para nada hasta ahora).
  let query = admin
    .from('brands')
    .select('*, campaigns:campaigns!brand_id(id, name, status, budget_total, currency)', { count: 'exact' })
    .order('name', { ascending: true })
    .limit(limit)

  if (search) query = query.ilike('name', `%${search}%`)

  const { data, error, count } = await query

  if (error) {
    console.error('[GET /api/brands]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Enriquecer con última conexión + fecha de creación de cuenta.
  // FIX (2026-07-13, pedido Pri): antes esto miraba SOLO auth.users.last_sign_in_at
  // del owner. Ahora usa el mismo criterio que la tabla de influencers
  // (profiles.last_seen_at primero — heartbeat real del portal, activo en
  // Marca desde este mismo batch — auth.users.last_sign_in_at como respaldo,
  // ver resolveLastSeen) Y considera que una marca puede tener MÁS de un
  // usuario con acceso (owner + brand_members): se muestra la conexión más
  // reciente entre todos, no solo la del owner.
  type BrandRow = Record<string, unknown> & {
    id: string
    user_id?: string | null
    created_at?: string | null
    organization_id?: string | null
  }
  const brands = (data ?? []) as BrandRow[]
  const brandIds = brands.map(b => b.id)
  const ownerUserIds = brands.map(b => b.user_id).filter((id): id is string => !!id)

  const { data: memberRows } = brandIds.length > 0
    ? await admin.from('brand_members').select('brand_id, user_id').in('brand_id', brandIds).not('user_id', 'is', null)
    : { data: [] as Array<{ brand_id: string; user_id: string }> }

  const membersByBrand = new Map<string, string[]>()
  for (const m of memberRows ?? []) {
    const list = membersByBrand.get(m.brand_id) ?? []
    list.push(m.user_id as string)
    membersByBrand.set(m.brand_id, list)
  }

  const allUserIds = Array.from(new Set([...ownerUserIds, ...(memberRows ?? []).map(m => m.user_id as string)]))
  const lastSeenMap = await resolveLastSeen(admin, allUserIds)

  const accountCreatedMap: Record<string, string | null> = {}
  for (const uid of ownerUserIds) {
    const { data: u } = await admin.auth.admin.getUserById(uid)
    if (u?.user) accountCreatedMap[uid] = u.user.created_at ?? null
  }

  function mostRecentLastSeen(userIds: string[]): string | null {
    let best: string | null = null
    for (const uid of userIds) {
      const seen = lastSeenMap[uid]
      if (seen && (!best || new Date(seen).getTime() > new Date(best).getTime())) best = seen
    }
    return best
  }

  // Plan interno efectivo individual para cada marca.
  const enriched = await Promise.all(brands.map(async b => {
    const candidateUserIds = [
      ...(b.user_id ? [b.user_id] : []),
      ...(membersByBrand.get(b.id) ?? []),
    ]
    return {
      ...b,
      last_sign_in_at: mostRecentLastSeen(candidateUserIds),
      // Fecha en que se creó la cuenta: prioriza auth.users.created_at del owner.
      account_created_at: b.user_id
        ? (accountCreatedMap[b.user_id] ?? b.created_at ?? null)
        : (b.created_at ?? null),
      org_plan: b.organization_id
        ? await resolveBrandPlan(admin, b.organization_id, b.id)
        : 'basic',
    }
  }))

  return NextResponse.json({ data: enriched, total: count ?? 0 })
}

// ── POST /api/brands ──────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return NextResponse.json({ error: 'Organization not found' }, { status: 400 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { name, logo_url, website, industry, contact_name, contact_email, contact_phone, notes } = body

  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 422 })

  // NOTA (2026-07-12): este endpoint NUNCA acepta `status` del body — cae
  // siempre en el default de la columna ('pending_approval'). Pedido explícito
  // de Pri para el flujo de marcas colaboradoras: "no permitir approved directo
  // desde el frontend". La creación de marcas colaboradoras vive en
  // POST /api/campaigns/[id]/brands (con su propia organización y sin asignar
  // hasta que Admin apruebe), NO en este endpoint.
  const { data, error } = await admin
    .from('brands')
    .insert({
      organization_id: orgId,
      name,
      logo_url:      logo_url ?? null,
      website:       website ?? null,
      industry:      industry ?? null,
      contact_name:  contact_name ?? null,
      contact_email: contact_email ?? null,
      contact_phone: contact_phone ?? null,
      notes:         notes ?? null,
      created_by:    user.id,
    })
    .select()
    .single()

  if (error) {
    console.error('[POST /api/brands]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data }, { status: 201 })
}
