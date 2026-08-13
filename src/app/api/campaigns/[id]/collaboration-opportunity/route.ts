import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { getOrgId, getUserRole, resolveBrandAccess } from '@/lib/supabase/ensureOrg'
type Params = { params: { id: string } }
export async function PUT(req: NextRequest, { params }: Params) {
  const supabase = createServerClient(); const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient(); const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const { data: campaign } = await admin.from('campaigns').select('id,brand_id,organization_id,metadata').eq('id', params.id).single()
  if (!campaign) return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })
  const access = await resolveBrandAccess(user.id)
  const org = access ? null : await getOrgId(user.id, user.user_metadata, admin)
  const allowed = access
    ? access.brandId === campaign.brand_id
    : Boolean(org && (await getUserRole(user.id, org, admin)).isAdmin)
  if (!allowed) return NextResponse.json({ error: 'Sin permiso para configurar esta campaña' }, { status: 403 })
  const current = campaign.metadata && typeof campaign.metadata === 'object' ? campaign.metadata as Record<string, unknown> : {}
  const config = { enabled: Boolean(body.enabled), benefits: String(body.benefits ?? '').trim(), participation_value: Math.max(0, Number(body.participation_value) || 0), currency: body.currency === 'USD' ? 'USD' : 'CLP', seats: Math.max(0, Math.trunc(Number(body.seats) || 0)), application_deadline: body.application_deadline || null }
  const { error } = await admin.from('campaigns').update({ metadata: { ...current, collaboration_opportunity: config }, updated_at: new Date().toISOString() }).eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 }); return NextResponse.json({ data: config })
}
