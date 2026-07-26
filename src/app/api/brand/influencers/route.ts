import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { startApifyInstagramSync } from '@/lib/influencers/apify'
import { resolveBrandAccess } from '@/lib/supabase/ensureOrg'
import { fetchAllRows } from '@/lib/supabase/fetchAllRows'
import {
  resolveBrandPlan,
  canViewFullInfluencerBase,
} from '@/lib/plan-limits'

// GET /api/brand/influencers
// Marca ve influencers relacionadas a SUS campañas/asignaciones.
// Misma shape que /api/influencers para reutilizar InfluencersClient.
export async function GET(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }


  const admin = createAdminClient()

  // Owner o miembro activo de brand_members (retira el patrón legacy
  // user_metadata.brand_id — spec Pri 2026-07-10).
  const access = await resolveBrandAccess(user.id)
  if (!access) {
    return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })
  }

  const { data: brand, error: brandError } = await admin
    .from('brands')
    .select('id, organization_id, name')
    .eq('id', access.brandId)
    .maybeSingle()

  if (brandError) {
    console.error('[GET /api/brand/influencers] brand:', brandError)
    return NextResponse.json({ error: brandError.message }, { status: 500 })
  }

  if (!brand) {
    return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })
  }

  const { searchParams } = new URL(req.url)
  const scope    = searchParams.get('scope') ?? ''
  const search   = searchParams.get('search')
  const platform = searchParams.get('platform')
  const category = searchParams.get('category')
  const country  = searchParams.get('country')
  const commune  = searchParams.get('commune')
  // Mismo criterio que /api/influencers: el filtro puede mandar varias
  // variantes crudas de la misma comuna separadas por coma (ver
  // /api/brand/influencers/communes + src/lib/communes-chile.ts).
  const communeList = commune ? commune.split(',').map(s => s.trim()).filter(Boolean) : []
  const verified = searchParams.get('verified')
  const isActive = searchParams.get('is_active')
  const rawSort  = searchParams.get('sort_by') ?? 'created_at'
  const sortDir  = searchParams.get('sort_dir') === 'asc'
  const page     = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const limit    = Math.max(1, parseInt(searchParams.get('limit') ?? '48', 10))
  const summaryOnly = searchParams.get('summary') === '1'

  const VALID_SORT_COLS = ['created_at', 'updated_at', 'display_name', 'rating', 'is_verified', 'is_active', 'country', 'city', 'commune'] as const
  const sortBy = (VALID_SORT_COLS as readonly string[]).includes(rawSort) ? rawSort : 'created_at'

  // La visibilidad se decide únicamente en servidor. Pro puede explorar el
  // catálogo completo; Basic/Growth solo pueden ver personas que POSTULARON a
  // campañas de esta marca. No se mezclan roster privado, invitaciones ni
  // participantes creados manualmente: eso evitaría que una marca gratuita
  // use este endpoint como catálogo encubierto.
  const orgPlan = await resolveBrandPlan(admin, brand.organization_id, brand.id)
  const fullAccess = canViewFullInfluencerBase(orgPlan)

  let restrictedInfluencerIds: string[] | null = null

  if (!fullAccess || scope === 'applicants') {
    const [
      { data: primaryCampaigns, error: primaryError },
      { data: collaboratorRows, error: collaboratorError },
    ] = await Promise.all([
      admin.from('campaigns').select('id').eq('brand_id', brand.id),
      admin.from('campaign_brands').select('campaign_id').eq('brand_id', brand.id),
    ])

    const relationError = primaryError ?? collaboratorError
    if (relationError) {
      return NextResponse.json({ error: relationError.message }, { status: 500 })
    }

    const campaignIds = Array.from(new Set([
      ...(primaryCampaigns ?? []).map(row => row.id),
      ...(collaboratorRows ?? []).map(row => row.campaign_id),
    ].filter(Boolean)))

    if (campaignIds.length === 0) {
      restrictedInfluencerIds = []
    } else {
      // "Postulante" = solicitud pendiente o aceptada. Las invitaciones
      // privadas y las solicitudes rechazadas no aparecen en esta vista.
      const { data: applicantRows, error: applicantError } = await admin
        .from('campaign_influencers')
        .select('influencer_id')
        .in('campaign_id', campaignIds)
        .in('application_status', ['pending', 'accepted'])

      if (applicantError) {
        return NextResponse.json({ error: applicantError.message }, { status: 500 })
      }

      restrictedInfluencerIds = Array.from(new Set(
        (applicantRows ?? []).map(row => row.influencer_id).filter(Boolean)
      ))
    }

    if (restrictedInfluencerIds.length === 0) {
      if (summaryOnly) {
        return NextResponse.json({
          summary: { total: 0, followers: 0, avg_engagement: 0, verified: 0 },
          full_access: false,
          scope: 'applicants',
        })
      }
      return NextResponse.json({
        data: [],
        total: 0,
        page,
        limit,
        full_access: false,
        scope: 'applicants',
      })
    }
  }

  if (summaryOnly) {
    const { data: summaryRows, error: summaryError } = await fetchAllRows<Record<string, unknown>>(
      (from, to) => {
        let q = admin.from('influencers').select(`
          id, display_name, city, commune, categories, is_verified,
          social_profiles:influencer_social_profiles(platform, followers, engagement_rate, is_primary)
        `).range(from, to)
        if (restrictedInfluencerIds) q = q.in('id', restrictedInfluencerIds)
        if (country) q = q.eq('country', country)
        if (communeList.length === 1) q = q.eq('commune', communeList[0])
        else if (communeList.length > 1) q = q.in('commune', communeList)
        if (verified === 'true') q = q.eq('is_verified', true)
        if (isActive === 'false') q = q.eq('is_active', false)
        if (isActive === 'true') q = q.eq('is_active', true)
        if (search) q = q.or(`display_name.ilike.%${search}%,city.ilike.%${search}%,commune.ilike.%${search}%`)
        if (category) q = q.contains('categories', [category])
        return q
      },
      { maxRows: 10000 }
    )

    if (summaryError) {
      const message = (summaryError as { message?: string }).message ?? 'Error cargando resumen'
      return NextResponse.json({ error: message }, { status: 500 })
    }

    const rows = platform
      ? summaryRows.filter(row => (row.social_profiles as Array<{ platform?: string }> | null)?.some(profile => profile.platform === platform))
      : summaryRows
    let followers = 0
    let engagement = 0
    let engagementRows = 0
    let verifiedCount = 0

    for (const row of rows) {
      const profiles = (row.social_profiles as Array<{ followers?: number | null; engagement_rate?: number | null; is_primary?: boolean }> | null) ?? []
      const primary = profiles.find(profile => profile.is_primary) ?? profiles[0]
      followers += Number(primary?.followers ?? 0)
      if (primary) {
        engagement += Number(primary.engagement_rate ?? 0)
        engagementRows += 1
      }
      if (row.is_verified) verifiedCount += 1
    }

    return NextResponse.json({
      summary: {
        total: rows.length,
        followers,
        avg_engagement: engagementRows ? engagement / engagementRows : 0,
        verified: verifiedCount,
      },
    })
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

  if (restrictedInfluencerIds) {
    query = query.in('id', restrictedInfluencerIds)
  }

  query = query
    .order(sortBy, { ascending: sortDir })
    .range((page - 1) * limit, page * limit - 1)

  if (country) query = query.eq('country', country)
  if (communeList.length === 1) query = query.eq('commune', communeList[0])
  else if (communeList.length > 1) query = query.in('commune', communeList)
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
    full_access: fullAccess,
    scope: fullAccess && scope !== 'applicants' ? 'catalog' : 'applicants',
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

  const access = await resolveBrandAccess(user.id)
  if (!access) {
    return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })
  }

  const { data: brand, error: brandError } = await admin
    .from('brands')
    .select('id, organization_id, name')
    .eq('id', access.brandId)
    .maybeSingle()

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

  // Auto-traer seguidores reales desde Instagram (pedido por Pri). Usa el
  // mismo handle que la marca acaba de ingresar — nunca un influencer_id
  // arbitrario del cliente, a diferencia de POST /api/influencers/sync-
  // instagram (admin), que si acepta influencer_ids del body. No bloquea la
  // respuesta: si Apify falla o no está configurado, la influencer queda
  // creada igual con followers en 0 (se puede sincronizar después).
  let apify_run_id: string | null = null
  const startedSync = await startApifyInstagramSync([igUsername])
  if ('runId' in startedSync) {
    apify_run_id = startedSync.runId
  } else {
    console.error('[POST /api/brand/influencers] apify sync:', startedSync.error)
  }

  return NextResponse.json({ data, apify_run_id }, { status: 201 })
}
