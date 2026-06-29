import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'

type Params = { params: { id: string } }

// GET /api/brand/campaigns/[id] — detalle de una campaña (solo si pertenece a la marca)
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!user.user_metadata?.is_brand) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()

  const { data: brand } = await admin
    .from('brands')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!brand) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })

  const { data, error } = await admin
    .from('campaigns')
    .select(`
      id, name, description, type, status, visibility, application_deadline,
      max_influencers, start_date, end_date,
      budget_total, currency, hashtags, platforms, content_guidelines,
      goals, created_at,
      campaign_influencers (
        id, application_status, origin, message, fee, currency, notes,
        influencer:influencers (
          id, display_name, avatar_url, city, country,
          influencer_social_profiles (platform, username, followers, engagement_rate)
        )
      ),
      campaign_deliverables (
        id, title, type, status, due_date, platform,
        content_url, submitted_at, published_url, review_notes, progress,
        influencer:influencers (id, display_name, avatar_url)
      )
    `)
    .eq('id', params.id)
    .eq('brand_id', brand.id)   // seguridad: solo campañas de esta marca
    .single()

  if (error) {
    if (error.code === 'PGRST116') return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data })
}
