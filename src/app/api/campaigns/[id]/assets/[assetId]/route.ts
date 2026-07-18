import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { resolveCampaignAssetAccess } from '@/lib/campaign-asset-access'

type Params = { params: { id: string; assetId: string } }

export async function DELETE(_request: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { admin, canManage } = await resolveCampaignAssetAccess(user.id, user.user_metadata, params.id)
  if (!canManage) return NextResponse.json({ error: 'No tienes permiso para eliminar archivos' }, { status: 403 })

  let query = admin
    .from('media_files')
    .select('id, organization_id, campaign_id, storage_path, metadata')
    .eq('id', params.assetId)
    .eq('campaign_id', params.id)
    .is('deliverable_id', null)

  const { data: asset, error: findError } = await query.maybeSingle()

  if (findError) {
    console.error('[DELETE /api/campaigns/[id]/assets/[assetId]] find', findError)
    return NextResponse.json({ error: findError.message }, { status: 500 })
  }

  if (!asset) {
    return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
  }

  const metadata = (asset.metadata ?? {}) as Record<string, unknown>
  if (metadata.kind === 'uploaded_file') {
    const bucket = String(metadata.bucket ?? 'campaign-assets')
    const { error: storageError } = await admin.storage.from(bucket).remove([asset.storage_path])
    if (storageError) {
      console.error('[DELETE /api/campaigns/[id]/assets/[assetId]] storage', storageError)
      return NextResponse.json({ error: storageError.message }, { status: 500 })
    }
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
