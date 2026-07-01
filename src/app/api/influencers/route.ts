import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'

// ── GET /api/influencers ──────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const search     = searchParams.get('search')
  const platform   = searchParams.get('platform')
  const category   = searchParams.get('category')
  const country    = searchParams.get('country')
  const verified   = searchParams.get('verified')
  const isActive   = searchParams.get('is_active')
  // Only allow columns that exist on the influencers table; derived fields like
  // 'followers' live in the join and cannot be used in .order() directly.
  const VALID_SORT_COLS = ['created_at', 'updated_at', 'display_name', 'rating', 'is_verified', 'country', 'city', 'commune'] as const
  const rawSort    = searchParams.get('sort_by') ?? 'created_at'
  const sortBy     = (VALID_SORT_COLS as readonly string[]).includes(rawSort) ? rawSort : 'created_at'
  const sortDir    = searchParams.get('sort_dir') === 'asc' ? true : false
  const page       = parseInt(searchParams.get('page') ?? '1', 10)
  const limit      = parseInt(searchParams.get('limit') ?? '100', 10)

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)

  let query = admin
    .from('influencers')
    .select(`
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
    `, { count: 'exact' })
    .order(sortBy, { ascending: sortDir })
    .range((page - 1) * limit, page * limit - 1)

  if (orgId)    query = query.eq('organization_id', orgId)
  if (country)  query = query.eq('country', country)
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

  const { data, error, count } = await query

  if (error) {
    console.error('[GET /api/influencers]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Filter by platform post-query (social_profiles is a join)
  const filtered = platform
    ? (data ?? []).filter(inf =>
        (inf.social_profiles as Array<{ platform: string }>)
          .some(sp => sp.platform === platform)
      )
    : (data ?? [])

  // Enriquecer última conexión en batch, sin consultar auth.users uno por uno
  const userIds = filtered.map(inf => inf.user_id).filter(Boolean) as string[]
  const lastSeenMap: Record<string, string | null> = {}

  if (userIds.length > 0) {
    const { data: profiles } = await admin
      .from('profiles')
      .select('id, last_seen_at')
      .in('id', userIds)

    for (const profile of profiles ?? []) {
      lastSeenMap[profile.id as string] = (profile.last_seen_at as string | null) ?? null
    }
  }

  const enriched = filtered.map(inf => ({
    ...inf,
    last_sign_in_at: inf.user_id ? (lastSeenMap[inf.user_id] ?? null) : null,
  }))

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
    bio, avatar_url, city, commune, country, address, address_lat, address_lng,
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
      avatar_url: avatar_url ?? null, city: city ?? null, commune: body.commune ?? null, country: country ?? null,
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
