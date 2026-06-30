import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'

type Params = { params: { id: string; assetId: string } }

export async function DELETE(_request: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)

  let query = admin
    .from('media_files')
    .select('id, organization_id, campaign_id')
    .eq('id', params.assetId)
    .eq('campaign_id', params.id)
    .is('deliverable_id', null)

  if (orgId) query = query.eq('organization_id', orgId)

  const { data: asset, error: findError } = await query.maybeSingle()

  if (findError) {
    console.error('[DELETE /api/campaigns/[id]/assets/[assetId]] find', findError)
    return NextResponse.json({ error: findError.message }, { status: 500 })
  }

  if (!asset) {
    return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
  }

  const { error } = await admin
    .from('media_files')
    .delete()
    .eq('id', params.assetId)
    .eq('campaign_id', params.id)

  if (error) {
    console.error('[DELETE /api/campaigns/[id]/assets/[assetId]] delete', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
