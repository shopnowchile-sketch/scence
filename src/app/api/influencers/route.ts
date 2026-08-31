import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { fetchAllRows } from '@/lib/supabase/fetchAllRows'
import { getPrimarySocial } from '@/lib/influencers/ranking'
import { resolveLastSeen } from '@/lib/supabase/lastSeen'
import { getOrgId, getUserRole } from '@/lib/supabase/ensureOrg'
import { getInfluencerProStatuses } from '@/lib/influencer-pro'

// 'followers' / 'engagement_rate' viven en la tabla join (influencer_social_profiles),
// no son columnas de `influencers` — Postgres/PostgREST no puede hacer .order() por
// ellas directamente. Pri reportó que el sort de "Más seguidores" en la lista
// principal "se echaba a perder" (silenciosamente caía a created_at). Fix: para
// estas 2 columnas se trae el dataset filtrado completo (sin cap de fila real,
// vía fetchAllRows) y se ordena/pagina en JS usando el mismo criterio de "red
// social primaria" que ya usa Ranking (getPrimarySocial).
// FIX (2026-07-13, pedido Pri): mismo problema que followers/engagement —
// `last_sign_in_at` no vive en `influencers` (viene de `profiles.last_seen_at`,
// enriquecido más abajo vía resolveLastSeen), así que tampoco puede ordenarse
// con .order() directo. Reusa el mismo mecanismo de "traer todo,
// ordenar/paginar en JS". Nulls (nunca conectado) siempre al final, en ambas
// direcciones — pedido explícito.
const JOIN_SORT_COLS = ['followers', 'engagement_rate', 'last_sign_in_at'] as const

// ── GET /api/influencers ──────────────────────────────────────────────────────
// Roster global — SOLO admin/staff SCENCE. Marca e influencer usan sus propias
// rutas (/api/brand/influencers, etc.) que sí acotan por org/relación.
// Desde que este roster puede devolver influencers de TODAS las marcas (para
// mostrar "Registrada por" / "Marcas asignadas" en el admin), este guard es
// obligatorio — antes esta ruta no verificaba rol.
export async function GET(request: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  const { isAdmin } = orgId ? await getUserRole(user.id, orgId, admin) : { isAdmin: false }
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const search     = searchParams.get('search')
  const platform   = searchParams.get('platform')
  const category   = searchParams.get('category')
  const country    = searchParams.get('country')
  const commune    = searchParams.get('commune')
  // El filtro "Comuna" del front (InfluencerFilters) manda todas las
  // variantes crudas de esa comuna real separadas por coma (ver
  // /api/influencers/communes + src/lib/communes-chile.ts groupCommunes) —
  // influencers.commune sigue sin normalizar en la base, así que hace falta
  // matchear cualquiera de esas variantes. Si viene un solo valor (deep links
  // viejos, ej. desde data-quality ranking) se comporta igual que antes.
  const communeList = commune ? commune.split(',').map(s => s.trim()).filter(Boolean) : []
  const verified   = searchParams.get('verified')
  const isActive   = searchParams.get('is_active')
  // Columnas ordenables directo en Postgres. 'followers'/'engagement_rate' se
  // manejan aparte (ver JOIN_SORT_COLS arriba) porque viven en la tabla join.
  const VALID_SORT_COLS = ['created_at', 'updated_at', 'display_name', 'rating', 'is_verified', 'is_active', 'country', 'city', 'commune', 'birth_date'] as const
  const rawSort    = searchParams.get('sort_by') ?? 'created_at'
  const sortBy     = (VALID_SORT_COLS as readonly string[]).includes(rawSort) ? rawSort : 'created_at'
  const sortDir    = searchParams.get('sort_dir') === 'asc' ? true : false
  const page       = parseInt(searchParams.get('page') ?? '1', 10)
  const limit      = parseInt(searchParams.get('limit') ?? '100', 10)
  const summaryOnly = searchParams.get('summary') === '1'

  // Roster global admin: sin filtro de organization_id — a diferencia de
  // /api/brand/influencers (que sí filtra por la marca), acá el caller ya
  // está garantizado admin/staff por el guard de arriba, y el objetivo es
  // justamente ver Scence + todas las marcas con su origen (ver enriquecido
  // más abajo: registered_by / associated_brands).

  if (summaryOnly) {
    const { data: summaryRows, error: summaryError } = await fetchAllRows<Record<string, unknown>>(
      (from, to) => {
        let q = admin.from('influencers').select(`
          id, display_name, email, city, commune, categories, is_verified,
          social_profiles:influencer_social_profiles(platform, followers, engagement_rate, is_primary)
        `).range(from, to)
        if (country) q = q.eq('country', country)
        if (communeList.length === 1) q = q.eq('commune', communeList[0])
        else if (communeList.length > 1) q = q.in('commune', communeList)
        if (verified === 'true') q = q.eq('is_verified', true)
        if (isActive === 'false') q = q.eq('is_active', false)
        if (isActive === 'true') q = q.eq('is_active', true)
        if (search) q = q.or(`display_name.ilike.%${search}%,email.ilike.%${search}%,city.ilike.%${search}%,commune.ilike.%${search}%`)
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

  const SELECT = `
      id,
      user_id,
      organization_id,
      display_name,
      bio,
      avatar_url,
      email,
      phone,
      whatsapp,
      country,
      city,
      commune,
      birth_date,
      address,
      categories,
      tags,
      is_verified,
      is_active,
      rating,
      metadata,
      created_at,
      updated_at,
      social_profiles:influencer_social_profiles (
        id,
        platform,
        username,
        profile_url,
        followers,
        engagement_rate,
        is_primary,
        verified
      ),
      rate_cards:influencer_rate_cards (
        id,
        deliverable_type,
        base_rate,
        currency,
        is_active
      )
    `

  const isJoinSort = (JOIN_SORT_COLS as readonly string[]).includes(rawSort)

  let data: Record<string, unknown>[] = []
  let count = 0
  let queryError: { message: string } | null = null

  if (isJoinSort) {
    // Sort por followers/engagement_rate: traer todo el dataset filtrado
    // (sin sort/paginación en la query) y ordenar/paginar en JS.
    const { data: allRows, error } = await fetchAllRows<Record<string, unknown>>(
      (from, to) => {
        let q = admin.from('influencers').select(SELECT).range(from, to)
        if (country)  q = q.eq('country', country)
        if (communeList.length === 1) q = q.eq('commune', communeList[0])
        else if (communeList.length > 1) q = q.in('commune', communeList)
        if (verified === 'true')  q = q.eq('is_verified', true)
        if (isActive === 'false') q = q.eq('is_active', false)
        if (isActive === 'true')  q = q.eq('is_active', true)
        if (search) {
          q = q.or(`display_name.ilike.%${search}%,email.ilike.%${search}%,city.ilike.%${search}%,commune.ilike.%${search}%`)
        }
        if (category) q = q.contains('categories', [category])
        return q
      },
      { maxRows: 5000 }
    )
    if (error) {
      queryError = error as { message: string }
    } else {
      const withPlatform = platform
        ? allRows.filter(inf => (inf.social_profiles as Array<{ platform: string }>).some(sp => sp.platform === platform))
        : allRows

      let sorted: Record<string, unknown>[]

      if (rawSort === 'last_sign_in_at') {
        // Se busca acá, ANTES de paginar, porque hace falta para ordenar el
        // dataset completo (no solo la página final).
        const uids = withPlatform.map(inf => inf.user_id as string | null).filter(Boolean) as string[]
        const seenMap = await resolveLastSeen(admin, uids)
        const withTs = withPlatform.map(inf => {
          const uid = inf.user_id as string | null
          const seen = uid ? seenMap[uid] ?? null : null
          return { inf, ts: seen ? new Date(seen).getTime() : null }
        })
        // Nulls (nunca conectado) siempre al final, sin importar la dirección.
        const withDate    = withTs.filter((x): x is { inf: Record<string, unknown>; ts: number } => x.ts !== null)
        const withoutDate = withTs.filter(x => x.ts === null).map(x => x.inf)
        withDate.sort((a, b) => sortDir ? a.ts - b.ts : b.ts - a.ts)
        sorted = [...withDate.map(x => x.inf), ...withoutDate]
      } else {
        const joinField = rawSort === 'followers' ? 'followers' : 'engagement_rate'
        const valueOf = (inf: Record<string, unknown>) => {
          const primary = getPrimarySocial(inf as never) as { followers?: number | null; engagement_rate?: number | null } | null
          return Number((joinField === 'followers' ? primary?.followers : primary?.engagement_rate) ?? 0)
        }
        sorted = [...withPlatform].sort((a, b) => {
          const va = valueOf(a)
          const vb = valueOf(b)
          return sortDir ? va - vb : vb - va
        })
      }

      count = sorted.length
      data = sorted.slice((page - 1) * limit, page * limit)
    }
  } else {
    let query = admin
      .from('influencers')
      .select(SELECT, { count: 'exact' })
      .order(sortBy, { ascending: sortDir })
      .range((page - 1) * limit, page * limit - 1)

    if (country)  query = query.eq('country', country)
    if (communeList.length === 1) query = query.eq('commune', communeList[0])
    else if (communeList.length > 1) query = query.in('commune', communeList)
    if (verified === 'true')  query = query.eq('is_verified', true)
    if (isActive === 'false') query = query.eq('is_active', false)
    if (isActive === 'true')  query = query.eq('is_active', true)
    if (search) {
      query = query.or(
        `display_name.ilike.%${search}%,email.ilike.%${search}%,city.ilike.%${search}%,commune.ilike.%${search}%`
      )
    }
    if (category) {
      query = query.contains('categories', [category])
    }

    const res = await query
    queryError = res.error
    data = (res.data ?? []) as unknown as Record<string, unknown>[]
    count = res.count ?? 0
  }

  if (queryError) {
    console.error('[GET /api/influencers]', queryError)
    return NextResponse.json({ error: queryError.message }, { status: 500 })
  }

  // Filter by platform post-query (social_profiles is a join) — ya aplicado
  // arriba en la rama isJoinSort, acá cubre la rama normal.
  const filtered = (!isJoinSort && platform)
    ? data.filter(inf =>
        (inf.social_profiles as Array<{ platform: string }>)
          .some(sp => sp.platform === platform)
      )
    : data

  // Enriquecer última conexión en batch — profiles.last_seen_at primero,
  // auth.users.last_sign_in_at como respaldo (ver resolveLastSeen arriba).
  const userIds = filtered.map(inf => inf.user_id as string | null).filter(Boolean) as string[]
  const lastSeenMap = await resolveLastSeen(admin, userIds)

  const withLastSeen: Array<Record<string, unknown>> = filtered.map(inf => {
    const uid = inf.user_id as string | null | undefined
    return {
      ...inf,
      last_sign_in_at: uid ? (lastSeenMap[uid] ?? null) : null,
    } as Record<string, unknown>
  })

  // ── "Registrada por" + "Marcas asignadas" ─────────────────────────────────
  // Fuente: brand_influencers (marca↔influencer, n:n) + influencers.organization_id.
  // No hay columna explícita de "quién creó esta fila" — se infiere así:
  //   - organization_id == org de Scence SpA (la más antigua)  → "SCENCE".
  //   - si no, la fila de brand_influencers MÁS ANTIGUA para esa influencer
  //     marca la marca creadora (ver comentario largo en
  //     POST /api/brand/influencers, que inserta influencer + su primera fila
  //     de brand_influencers en el mismo request — cualquier asignación
  //     posterior de otra marca queda con created_at más nuevo).
  //   Esta inferencia depende de que brand_influencers SOLO se escriba desde
  //   flujos controlados de la app (hoy: este POST). Como la tabla está vacía
  //   hasta ahora, queda correcta desde este cambio en adelante.
  const influencerIds = withLastSeen.map(inf => inf.id as string)
  const brandsByInfluencer = new Map<string, Array<{ id: string; name: string; created_at: string }>>()

  if (influencerIds.length > 0) {
    const { data: biRows } = await admin
      .from('brand_influencers')
      .select('influencer_id, brand_id, created_at, brands(name)')
      .in('influencer_id', influencerIds)

    for (const row of (biRows ?? []) as unknown as Array<{ influencer_id: string; brand_id: string; created_at: string; brands: { name: string } | null }>) {
      const list = brandsByInfluencer.get(row.influencer_id) ?? []
      list.push({ id: row.brand_id, name: row.brands?.name ?? 'Marca', created_at: row.created_at })
      brandsByInfluencer.set(row.influencer_id, list)
    }
    for (const list of Array.from(brandsByInfluencer.values())) {
      list.sort((a, b) => a.created_at.localeCompare(b.created_at))
    }
  }

  // Org de Scence SpA = la organización más antigua (mismo criterio que
  // ensureInfluencerRow usa para "la organización real").
  const { data: oldestOrg } = await admin
    .from('organizations')
    .select('id')
    .order('created_at', { ascending: true })
    .limit(1)
    .single()
  const scenceOrgId = oldestOrg?.id ?? null

  const proStatuses = await getInfluencerProStatuses(admin, withLastSeen.map(inf => inf.id as string))
  const enriched = withLastSeen.map(inf => {
    const orgId = inf.organization_id as string | null
    const brandsForInf = brandsByInfluencer.get(inf.id as string) ?? []
    const associated_brands = brandsForInf.map(b => ({ id: b.id, name: b.name }))

    let registered_by: string
    if (!orgId || orgId === scenceOrgId) {
      registered_by = 'SCENCE'
    } else if (brandsForInf.length > 0) {
      registered_by = brandsForInf[0].name // fila más antigua = marca creadora
    } else {
      registered_by = 'Marca' // org de marca sin fila en brand_influencers (caso raro/legado)
    }

    const pro_source = proStatuses.get(inf.id as string) ?? 'free'
    return { ...inf, is_pro: pro_source !== 'free', pro_source, registered_by, associated_brands }
  })

  return NextResponse.json({ data: enriched, total: count ?? 0, page, limit })
}

// ── POST /api/influencers ─────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const {
    display_name, email, phone,
    bio, avatar_url, city, commune, birth_date, country, address, address_lat, address_lng,
    categories, tags, is_verified = false, is_active = false,  // Default: draft
    social_profiles = [], rate_cards = [], organization_id,
    notes, first_name, last_name,
  } = body as Record<string, unknown>

  if (!display_name) {
    return NextResponse.json({ error: 'display_name is required' }, { status: 422 })
  }

  // Validación: Instagram es el identificador principal del sistema.
  // Debe venir instagram_url directo o un social_profile de instagram con profile_url.
  const igUrl = (body.instagram_url as string) ?? null
  const hasIgProfile = (social_profiles as Array<Record<string, unknown>>).some(
    sp => sp.platform === 'instagram' && (sp.profile_url || sp.instagram_url || sp.username)
  )
  if (!igUrl && !hasIgProfile) {
    return NextResponse.json(
      { error: 'instagram_url es obligatorio. Instagram es el identificador principal del sistema.' },
      { status: 422 }
    )
  }

  const orgId = (organization_id as string) ?? user.user_metadata?.organization_id
  const admin = createAdminClient()

  // first_name / last_name don't have dedicated columns — store in metadata
  const meta: Record<string, unknown> = {}
  if (first_name) meta.first_name = first_name
  if (last_name)  meta.last_name  = last_name

  const { data: influencer, error: infErr } = await admin
    .from('influencers')
    .insert({
      organization_id: orgId,
      display_name,
      email: email ?? null, phone: phone ?? null, bio: bio ?? null,
      avatar_url: avatar_url ?? null, city: city ?? null, commune: body.commune ?? null, birth_date: birth_date ?? null, country: country ?? null,
      address: address ?? null, address_lat: address_lat ?? null, address_lng: address_lng ?? null,
      categories: categories ?? [], tags: tags ?? [],
      is_verified, is_active, notes: notes ?? null,
      metadata: Object.keys(meta).length > 0 ? meta : {},
    })
    .select()
    .single()

  if (infErr) {
    console.error('[POST /api/influencers]', infErr)
    return NextResponse.json({ error: infErr.message }, { status: 500 })
  }

  // Insert social profiles — normalize followers_count → followers, service_type → deliverable_type
  const profilesArr = social_profiles as Array<Record<string, unknown>>
  if (profilesArr.length > 0) {
    const { error: spErr } = await admin.from('influencer_social_profiles').insert(
      profilesArr.map(({ followers_count, ...sp }) => ({
        ...sp,
        followers: (followers_count as number) ?? (sp.followers as number) ?? 0,
        influencer_id: influencer.id,
      }))
    )
    if (spErr) console.error('[POST /api/influencers] social_profiles:', spErr)
  }

  // Insert rate cards — normalize service_type → deliverable_type
  const ratesArr = rate_cards as Array<Record<string, unknown>>
  if (ratesArr.length > 0) {
    const { error: rcErr } = await admin.from('influencer_rate_cards').insert(
      ratesArr.map(({ service_type, ...rc }) => ({
        ...rc,
        deliverable_type: (service_type as string) ?? rc.deliverable_type,
        influencer_id: influencer.id,
      }))
    )
    if (rcErr) console.error('[POST /api/influencers] rate_cards:', rcErr)
  }

  // ── Auto-create affiliate link using Instagram username as code ──────────────
  try {
    // Get Instagram username from social profiles or igUrl
    let igUsername: string | null = null
    if (profilesArr.length > 0) {
      const igProfile = profilesArr.find(sp => sp.platform === 'instagram')
      if (igProfile) {
        igUsername = (igProfile.username as string | null)
          ?? (() => {
            const url = (igProfile.profile_url ?? igProfile.instagram_url) as string | null
            if (!url) return null
            try {
              const parts = new URL(url).pathname.split('/').filter(Boolean)
              return parts[parts.length - 1]?.replace(/^@/, '') ?? null
            } catch { return null }
          })()
      }
    }
    if (!igUsername && igUrl) {
      try {
        const parts = new URL(igUrl).pathname.split('/').filter(Boolean)
        igUsername = parts[parts.length - 1]?.replace(/^@/, '') ?? null
      } catch { igUsername = null }
    }

    if (igUsername && orgId) {
      // Check code is unique — append _2, _3 etc. if needed
      let code = igUsername.toLowerCase().replace(/[^a-z0-9_]/g, '')
      const { data: existing } = await admin
        .from('affiliate_links').select('id').eq('code', code).maybeSingle()
      if (existing) code = `${code}_${influencer.id.slice(0, 6)}`

      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'
      await admin.from('affiliate_links').insert({
        organization_id: orgId,
        influencer_id:   influencer.id,
        name:            `Link de afiliado — ${display_name}`,
        code,
        redirect_url:    `https://www.instagram.com/${igUsername}`,
        full_link:       `${appUrl}/track/${code}`,
        clicks:          0,
        conversions:     0,
        revenue:         0,
        currency:        'CLP',
        is_active:       true,
      })
    }
  } catch (e) {
    // Non-fatal — influencer is created even if affiliate link fails
    console.error('[auto-affiliate-link] failed:', e)
  }

  const { data } = await admin
    .from('influencers')
    .select('*, influencer_social_profiles(*), influencer_rate_cards(*)')
    .eq('id', influencer.id)
    .single()

  return NextResponse.json({ data }, { status: 201 })
}
