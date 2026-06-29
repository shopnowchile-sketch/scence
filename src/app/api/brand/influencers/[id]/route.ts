import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'

type Params = { params: { id: string } }

// GET /api/brand/influencers/[id]
// Retorna un influencer por ID — datos limitados para la vista de marca
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!user.user_metadata?.is_brand) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()

  // Verificar que el influencer pertenece a la misma org que la marca
  const { data: brand } = await admin
    .from('brands')
    .select('organization_id')
    .eq('user_id', user.id)
    .single()

  if (!brand) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })

  const { data, error } = await admin
    .from('influencers')
    .select(`
      id, display_name, bio, avatar_url, categories, country, city,
      influencer_social_profiles (
        platform, username, followers, engagement_rate, is_primary
      ),
      influencer_rate_cards (
        deliverable_type, base_rate, currency
      )
    `)
    .eq('id', params.id)
    .eq('organization_id', brand.organization_id)
    .eq('is_active', true)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return NextResponse.json({ error: 'Influencer no encontrado' }, { status: 404 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data })
}
