import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'

type Params = { params: { id: string } }

// GET /api/brand/campaigns/[id]/barters — solo lectura, scoped a la marca del usuario
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!user.user_metadata?.is_brand) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()

  // Marcas que el usuario posee o de las que es miembro activo
  const { data: owned }   = await admin.from('brands').select('id').eq('user_id', user.id)
  const { data: member }  = await admin.from('brand_members')
    .select('brand_id').eq('user_id', user.id).eq('is_active', true)

  const brandIds = [
    ...(owned ?? []).map(b => b.id),
    ...(member ?? []).map(m => m.brand_id),
  ]
  if (brandIds.length === 0) return NextResponse.json({ data: [] })

  const { data, error } = await admin
    .from('barters')
    .select(`
      id, item, description, estimated_value, currency, status, evidence_url,
      agreed_date, created_at, updated_at,
      influencer:influencers (id, display_name, avatar_url),
      history:barter_status_history (id, barter_id, from_status, to_status, note, created_at)
    `)
    .eq('campaign_id', params.id)
    .in('brand_id', brandIds)   // seguridad: solo canjes de marcas del usuario
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[GET /api/brand/campaigns/[id]/barters]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const normalized = (data ?? []).map((b: any) => ({
    ...b,
    history: [...(b.history ?? [])].sort((a: any, z: any) => (a.created_at < z.created_at ? -1 : 1)),
  }))

  return NextResponse.json({ data: normalized })
}
