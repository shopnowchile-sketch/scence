import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { getOrgId, getUserRole } from '@/lib/supabase/ensureOrg'
import { getInfluencerProStatuses } from '@/lib/influencer-pro'

type Params = { params: { id: string } }

export async function PATCH(request: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, undefined, admin)
  const access = orgId ? await getUserRole(user.id, orgId, admin) : null
  if (!access?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: { active?: boolean }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (typeof body.active !== 'boolean') return NextResponse.json({ error: 'active es requerido' }, { status: 422 })

  const { data: influencer } = await admin.from('influencers').select('id, metadata').eq('id', params.id).maybeSingle()
  if (!influencer) return NextResponse.json({ error: 'Influencer no encontrada' }, { status: 404 })
  const metadata = (influencer.metadata as Record<string, unknown> | null) ?? {}
  const manual_pro = body.active
    ? { active: true, granted_at: new Date().toISOString(), granted_by: user.id }
    : { active: false, revoked_at: new Date().toISOString(), revoked_by: user.id }

  const { error } = await admin.from('influencers').update({ metadata: { ...metadata, manual_pro }, updated_at: new Date().toISOString() }).eq('id', params.id)
  if (error) return NextResponse.json({ error: 'No se pudo actualizar el plan.' }, { status: 500 })

  const source = (await getInfluencerProStatuses(admin, [params.id])).get(params.id) ?? 'free'
  return NextResponse.json({ ok: true, is_pro: source !== 'free', pro_source: source })
}
