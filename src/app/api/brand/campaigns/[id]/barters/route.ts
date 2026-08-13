import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { hasBrandPermission, resolveBrandAccess } from '@/lib/supabase/ensureOrg'

type Params = { params: { id: string } }

// GET /api/brand-campaigns/[id]/barters — solo lectura, scoped a la marca del usuario
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const access = await resolveBrandAccess(user.id)
  if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!hasBrandPermission(access, 'campaign.read')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data, error } = await admin
    .from('barters')
    .select(`
      id, item, description, estimated_value, currency, status, simple_status, evidence_url,
      agreed_date, completed_at, cancelled_at, cancellation_reason, created_at, updated_at,
      benefits:barter_benefits (
        id, benefit_type, description, fixed_value, currency,
        commission_rate, affiliate_link_id, delivery_method, status, delivered_at,
        completed_at, status_note, position
      ),
      influencer:influencers (id, display_name, avatar_url),
      history:barter_status_history (id, barter_id, from_status, to_status, note, created_at)
    `)
    .eq('campaign_id', params.id)
    .eq('brand_id', access.brandId) // seguridad: solo canjes de la marca oficial
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[GET /api/brand-campaigns/[id]/barters]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const normalized = (data ?? []).map((b: any) => ({
    ...b,
    history: [...(b.history ?? [])].sort((a: any, z: any) => (a.created_at < z.created_at ? -1 : 1)),
  }))

  return NextResponse.json({ data: normalized })
}
