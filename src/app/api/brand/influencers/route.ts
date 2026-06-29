import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'

// GET /api/brand/influencers
// Catálogo de influencers activos — datos limitados para marcas
// La marca NO ve: email, teléfono, tarifas históricas de otras marcas, status interno
export async function GET(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!user.user_metadata?.is_brand) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()

  // Resolver org_id de la marca
  const { data: brand } = await admin
    .from('brands')
    .select('organization_id')
    .eq('user_id', user.id)
    .single()

  if (!brand) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })

  const { searchParams } = new URL(req.url)
  const search   = searchParams.get('search') ?? ''
  const category = searchParams.get('category') ?? ''
  const platform = searchParams.get('platform') ?? ''
  const page     = Math.max(0, Number(searchParams.get('page') ?? 0))
  const limit    = 24

  let query = admin
    .from('influencers')
    .select(`
      id, display_name, bio, avatar_url, categories, country, city,
      influencer_social_profiles (
        platform, username, followers, engagement_rate, is_primary
      ),
      influencer_rate_cards (
        deliverable_type, base_rate, currency
      )
    `, { count: 'exact' })
    .eq('organization_id', brand.organization_id)
    .eq('is_active', true)
    .order('display_name', { ascending: true })
    .range(page * limit, (page + 1) * limit - 1)

  if (search) {
    query = query.ilike('display_name', `%${search}%`)
  }
  if (category) {
    query = query.contains('categories', [category])
  }

  const { data, error, count } = await query

  if (error) {
    console.error('[GET /api/brand/influencers]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Filtrar por plataforma después de fetch (más simple que JOIN complejo)
  const filtered = platform
    ? (data ?? []).filter((inf: { influencer_social_profiles: { platform: string }[] }) =>
        inf.influencer_social_profiles?.some((p) => p.platform === platform)
      )
    : (data ?? [])

  return NextResponse.json({
    data: filtered,
    total: count ?? 0,
    page,
    limit,
  })
}
