import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'

// GET /api/brand/influencers
// Marca ve influencers relacionadas a SUS campañas/asignaciones.
// Misma shape que /api/influencers para reutilizar InfluencersClient.
export async function GET(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!user.user_metadata?.is_brand) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createAdminClient()
  const metaBrandId = user.user_metadata?.brand_id as string | undefined

  // Owner: por user_id. Invitado: por metadata.brand_id.
  let brandQuery = admin
    .from('brands')
    .select('id, organization_id, name')
    .limit(1)

  if (metaBrandId) {
    brandQuery = brandQuery.eq('id', metaBrandId)
  } else {
    brandQuery = brandQuery.eq('user_id', user.id)
  }

  const { data: brand, error: brandError } = await brandQuery.maybeSingle()

  if (brandError) {
    console.error('[GET /api/brand/influencers] brand:', brandError)
    return NextResponse.json({ error: brandError.message }, { status: 500 })
  }

  if (!brand) {
    return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })
  }

  const { searchParams } = new URL(req.url)
  const search   = searchParams.get('search')
  const platform = searchParams.get('platform')
  const category = searchParams.get('category')
  const country  = searchParams.get('country')
  const commune  = searchParams.get('commune')
  const verified = searchParams.get('verified')
  const isActive = searchParams.get('is_active')
  const rawSort  = searchParams.get('sort_by') ?? 'created_at'
  const sortDir  = searchParams.get('sort_dir') === 'asc'
  const page     = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const limit    = Math.max(1, parseInt(searchParams.get('limit') ?? '48', 10))

  const VALID_SORT_COLS = ['created_at', 'updated_at', 'display_name', 'rating', 'is_verified', 'is_active', 'country', 'city', 'commune'] as const
  const sortBy = (VALID_SORT_COLS as readonly string[]).includes(rawSort) ? rawSort : 'created_at'

  // 1) campañas donde la marca es principal
  const { data: primaryCampaigns, error: primaryErr } = await admin
    .from('campaigns')
    .select('id')
    .eq('brand_id', brand.id)

  if (primaryErr) {
    console.error('[GET /api/brand/influencers] campaigns:', primaryErr)
    return NextResponse.json({ error: primaryErr.message }, { status: 500 })
  }

  // 2) campañas donde la marca es colaboradora
  const { data: collaboratorRows, error: cbErr } = await admin
    .from('campaign_brands')
    .select('campaign_id')
    .eq('brand_id', brand.id)

  if (cbErr) {
    console.error('[GET /api/brand/influencers] campaign_brands:', cbErr)
    return NextResponse.json({ error: cbErr.message }, { status: 500 })
  }

  const campaignIds = Array.from(new Set([
    ...(primaryCampaigns ?? []).map(c => c.id),
    ...(collaboratorRows ?? []).map(r => r.campaign_id),
  ].filter(Boolean)))

  // 3) influencers asignadas a esas campañas
  let campaignInfluencerIds: string[] = []
  if (campaignIds.length > 0) {
    const { data: ciRows, error: ciErr } = await admin
      .from('campaign_influencers')
      .select('influencer_id')
      .in('campaign_id', campaignIds)

    if (ciErr) {
      console.error('[GET /api/brand/influencers] campaign_influencers:', ciErr)
      return NextResponse.json({ error: ciErr.message }, { status: 500 })
    }

    campaignInfluencerIds = (ciRows ?? [])
      .map(r => r.influencer_id)
      .filter(Boolean)
  }

  // 4) influencers asignadas directamente a la marca, si existe brand_influencers
  let directInfluencerIds: string[] = []
  try {
    const { data: directRows } = await admin
      .from('brand_influencers')
      .select('influencer_id')
      .eq('brand_id', brand.id)

    directInfluencerIds = (directRows ?? [])
      .map(r => r.influencer_id)
      .filter(Boolean)
  } catch {
    directInfluencerIds = []
  }

  const influencerIds = Array.from(new Set([
    ...campaignInfluencerIds,
    ...directInfluencerIds,
  ]))

  if (influencerIds.length === 0) {
    return NextResponse.json({ data: [], total: 0, page, limit })
  }

  // Columnas explícitas — NUNCA '*'. La marca no debe recibir email, phone,
  // whatsapp, notes, metadata ni user_id (mismo criterio que /api/brand/influencers/[id]).
  let query = admin
    .from('influencers')
    .select(`
      id,
      display_name,
      bio,
      avatar_url,
      country,
      city,
      commune,
      categories,
      tags,
      is_verified,
      is_active,
      rating,
      created_at,
      updated_at,
      social_profiles:influencer_social_profiles (
        id, platform, username, profile_url, followers, engagement_rate, is_primary, verified
      ),
      rate_cards:influencer_rate_cards (
        id, deliverable_type, base_rate, currency, is_active
      )
    `, { count: 'exact' })
    .in('id', influencerIds)
    .order(sortBy, { ascending: sortDir })
    .range((page - 1) * limit, page * limit - 1)

  if (country) query = query.eq('country', country)
  if (commune) query = query.eq('commune', commune)
  if (verified === 'true') query = query.eq('is_verified', true)
  if (isActive === 'false') query = query.eq('is_active', false)
  if (isActive === 'true') query = query.eq('is_active', true)
  if (search) {
    query = query.or(`display_name.ilike.%${search}%,city.ilike.%${search}%`)
  }
  if (category) {
    query = query.contains('categories', [category])
  }

  const { data, error, count } = await query

  if (error) {
    console.error('[GET /api/brand/influencers]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const filtered = platform
    ? (data ?? []).filter(inf =>
        (inf.social_profiles as Array<{ platform: string }> | undefined)
          ?.some(sp => sp.platform === platform)
      )
    : (data ?? [])

  return NextResponse.json({
    data: filtered,
    total: count ?? filtered.length,
    page,
    limit,
  })
}

// ── POST /api/brand/influencers ───────────────────────────────────────────────
// Marca agrega una influencer manualmente a SU roster (mismo flujo que el
// admin en /admin-influencers/new, pero acotado a la marca autenticada).
//
// Seguridad: organization_id y brand_id SIEMPRE se resuelven server-side desde
// el usuario autenticado (mismo patrón que GET arriba: owner por user_id o
// invitado por metadata.brand_id). Nunca se toman del body, aunque vengan.
//
// Duplicados: se valida por email/instagram tanto dentro del roster propio de
// la marca como cruzando TODO `influencers` (Scence + otras marcas). Si ya
// existe en otra marca u org, se bloquea con mensaje genérico — nunca se
// revela a quién pertenece (evita filtrar datos de otra marca).
export async function POST(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!user.user_metadata?.is_brand) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createAdminClient()
  const metaBrandId = user.user_metadata?.brand_id as string | undefined

  let brandQuery = admin
    .from('brands')
    .select('id, organization_id, name')
    .limit(1)

  brandQuery = metaBrandId
    ? brandQuery.eq('id', metaBrandId)
    : brandQuery.eq('user_id', user.id)

  const { data: brand, error: brandError } = await brandQuery.maybeSingle()

  if (brandError) {
    console.error('[POST /api/brand/influencers] brand:', brandError)
    return NextResponse.json({ error: brandError.message }, { status: 500 })
  }
  if (!brand) {
    return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })
  }

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  // organization_id / brand_id: NUNCA se aceptan del body, aunque vengan.
  const {
    display_name, email, phone, bio, avatar_url, city, commune, birth_date, country,
    address, address_lat, address_lng, categories, tags,
    is_verified = false, is_active = true,
    social_profiles = [], rate_cards = [], notes, first_name, last_name,
  } = body as Record<string, unknown>

  if (!display_name || typeof display_name !== 'string' || !display_name.trim()) {
    return NextResponse.json({ error: 'El nombre es requerido' }, { status: 422 })
  }
  if (!email || typeof email !== 'string' || !email.trim()) {
    return NextResponse.json({ error: 'El email es requerido' }, { status: 422 })
  }

  // Instagram es el identificador principal del sistema (misma regla que admin).
  const profilesArr = social_profiles as Array<Record<string, unknown>>
  const igProfile = profilesArr.find(sp => sp.platform === 'instagram')
  const igUsernameRaw = (igProfile?.username as string | undefined)
    ?? (body.instagram_url ? (() => {
      try {
        const parts = new URL(body.instagram_url as string).pathname.split('/').filter(Boolean)
        return parts[parts.length - 1]?.replace(/^@/, '') ?? null
      } catch { return null }
    })() : null)

  if (!igUsernameRaw) {
    return NextResponse.json(
      { error: 'Instagram es obligatorio. Instagram es el identificador principal del sistema.' },
      { status: 422 }
    )
  }
  const igUsername = igUsernameRaw.toLowerCase().trim()
  const emailNorm = typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null

  // ── Duplicados ──────────────────────────────────────────────────────────────
  // 1) Buscar por instagram username en toda la tabla (cualquier org).
  const { data: igMatches } = await admin
    .from('influencer_social_profiles')
    .select('influencer_id, influencer:influencers(id, organization_id, display_name)')
    .eq('platform', 'instagram')
    .ilike('username', igUsername)

  // 2) Buscar por email en toda la tabla (cualquier org), si vino email.
  let emailMatches: Array<{ id: string; organization_id: string | null }> = []
  if (emailNorm) {
    const { data } = await admin
      .from('influencers')
      .select('id, organization_id')
      .ilike('email', emailNorm)
    emailMatches = data ?? []
  }

  type MatchRow = { id: string; organization_id: string | null }
  const allMatches: MatchRow[] = [
    ...((igMatches ?? []).map(m => m.influencer as unknown as MatchRow).filter(Boolean)),
    ...emailMatches,
  ]

  if (allMatches.length > 0) {
    const ownBrandMatch = allMatches.find(m => m.organization_id === brand.organization_id)
    if (ownBrandMatch) {
      return NextResponse.json(
        { error: 'Ya tienes esta influencer en tu roster.', code: 'DUPLICATE_OWN' },
        { status: 409 }
      )
    }
    // Existe en Scence o en otra marca — NO se fusiona automáticamente y NO se
    // revela a quién pertenece (evita exponer datos de otra marca/org).
    return NextResponse.json(
      {
        error: 'Ya existe una influencer registrada con este Instagram o email en el sistema. Contacta a SCENCE para revisar antes de crear un duplicado.',
        code: 'DUPLICATE_EXTERNAL',
      },
      { status: 409 }
    )
  }

  // ── Insert ────────────────────────────────────────────────────────────────
  const meta: Record<string, unknown> = {}
  if (first_name) meta.first_name = first_name
  if (last_name)  meta.last_name  = last_name

  const { data: influencer, error: infErr } = await admin
    .from('influencers')
    .insert({
      organization_id: brand.organization_id, // ← forzado server-side, nunca del body
      display_name: (display_name as string).trim(),
      email: emailNorm, phone: phone ?? null, bio: bio ?? null,
      avatar_url: avatar_url ?? null, city: city ?? null, commune: commune ?? null,
      birth_date: birth_date ?? null, country: country ?? null,
      address: address ?? null, address_lat: address_lat ?? null, address_lng: address_lng ?? null,
      categories: categories ?? [], tags: tags ?? [],
      is_verified, is_active, notes: notes ?? null,
      metadata: Object.keys(meta).length > 0 ? meta : {},
    })
    .select()
    .single()

  if (infErr) {
    console.error('[POST /api/brand/influencers]', infErr)
    return NextResponse.json({ error: infErr.message }, { status: 500 })
  }

  if (profilesArr.length > 0) {
    const { error: spErr } = await admin.from('influencer_social_profiles').insert(
      profilesArr.map(({ followers_count, ...sp }) => ({
        ...sp,
        followers: (followers_count as number) ?? (sp.followers as number) ?? 0,
        influencer_id: influencer.id,
      }))
    )
    if (spErr) console.error('[POST /api/brand/influencers] social_profiles:', spErr)
  }

  const ratesArr = rate_cards as Array<Record<string, unknown>>
  if (ratesArr.length > 0) {
    const { error: rcErr } = await admin.from('influencer_rate_cards').insert(
      ratesArr.map(({ service_type, ...rc }) => ({
        ...rc,
        deliverable_type: (service_type as string) ?? rc.deliverable_type,
        influencer_id: influencer.id,
      }))
    )
    if (rcErr) console.error('[POST /api/brand/influencers] rate_cards:', rcErr)
  }

  // Vínculo marca↔influencer. Esta fila (la más antigua para esta influencer)
  // es la que /api/influencers usa para inferir "Registrada por" en el admin —
  // ver comentario en ese archivo. Depende de que brand_influencers solo se
  // escriba desde flujos controlados de la app (este POST y el futuro flujo
  // de asignación admin, si se construye).
  const { error: linkErr } = await admin.from('brand_influencers').insert({
    brand_id: brand.id,
    influencer_id: influencer.id,
    organization_id: brand.organization_id,
  })
  if (linkErr) console.error('[POST /api/brand/influencers] brand_influencers link:', linkErr)

  const { data } = await admin
    .from('influencers')
    .select('*, influencer_social_profiles(*), influencer_rate_cards(*)')
    .eq('id', influencer.id)
    .single()

  return NextResponse.json({ data }, { status: 201 })
}
