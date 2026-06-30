import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'

type Params = { params: { id: string } }

const BUCKET = 'campaign-assets'

function safeFilename(name: string) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160) || 'asset'
}

async function assertCampaignAccess(userId: string, userMetadata: Record<string, unknown>, campaignId: string) {
  const admin = createAdminClient()
  const orgId = await getOrgId(userId, userMetadata, admin)

  let query = admin
    .from('campaigns')
    .select('id, organization_id')
    .eq('id', campaignId)

  if (orgId) query = query.eq('organization_id', orgId)

  const { data: campaign, error } = await query.maybeSingle()

  if (error) throw error
  if (!campaign) return { admin, orgId, campaign: null }

  return { admin, orgId, campaign }
}

async function ensureBucket(admin: ReturnType<typeof createAdminClient>) {
  const { data: buckets } = await admin.storage.listBuckets()
  const exists = buckets?.some(bucket => bucket.name === BUCKET)
  if (!exists) {
    await admin.storage.createBucket(BUCKET, {
      public: false,
      fileSizeLimit: 50 * 1024 * 1024,
    })
  }
}

export async function GET(_request: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { admin, orgId, campaign } = await assertCampaignAccess(user.id, user.user_metadata, params.id)
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  let query = admin
    .from('media_files')
    .select('*')
    .eq('campaign_id', params.id)
    .is('deliverable_id', null)
    .order('created_at', { ascending: false })

  if (orgId) query = query.eq('organization_id', orgId)

  const { data, error } = await query

  if (error) {
    console.error('[GET /api/campaigns/[id]/assets]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const withUrls = await Promise.all((data ?? []).map(async asset => {
    const meta = (asset.metadata ?? {}) as Record<string, unknown>
    if (meta.kind === 'uploaded_file') {
      const { data: signed } = await admin.storage
        .from(BUCKET)
        .createSignedUrl(asset.storage_path, 60 * 60)

      return { ...asset, signed_url: signed?.signedUrl ?? null }
    }

    return { ...asset, signed_url: asset.storage_path }
  }))

  return NextResponse.json({ data: withUrls })
}

export async function POST(request: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { admin, orgId, campaign } = await assertCampaignAccess(user.id, user.user_metadata, params.id)
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  const contentType = request.headers.get('content-type') ?? ''
  const finalOrgId = orgId ?? campaign.organization_id

  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData()
    const file = formData.get('file')
    const customName = String(formData.get('filename') ?? '').trim()

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file is required' }, { status: 422 })
    }

    await ensureBucket(admin)

    const originalName = file.name || 'asset'
    const filename = customName || originalName
    const storagePath = `${finalOrgId}/${params.id}/${crypto.randomUUID()}-${safeFilename(originalName)}`
    const bytes = await file.arrayBuffer()

    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(storagePath, bytes, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      })

    if (uploadError) {
      console.error('[POST /api/campaigns/[id]/assets] upload', uploadError)
      return NextResponse.json({ error: uploadError.message }, { status: 500 })
    }

    const { data, error } = await admin
      .from('media_files')
      .insert({
        organization_id: finalOrgId,
        campaign_id: params.id,
        deliverable_id: null,
        uploaded_by: user.id,
        filename,
        storage_path: storagePath,
        mime_type: file.type || null,
        size_bytes: file.size,
        tags: ['campaign_asset'],
        metadata: {
          source: 'campaign_assets_tab',
          kind: 'uploaded_file',
          bucket: BUCKET,
          original_name: originalName,
        },
        is_public: false,
      })
      .select()
      .single()

    if (error) {
      console.error('[POST /api/campaigns/[id]/assets] insert file', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ data }, { status: 201 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const filename = String(body.filename ?? '').trim()
  const url = String(body.url ?? '').trim()

  if (!url) {
    return NextResponse.json({ error: 'url is required' }, { status: 422 })
  }

  try {
    new URL(url)
  } catch {
    return NextResponse.json({ error: 'URL inválida' }, { status: 422 })
  }

  const { data, error } = await admin
    .from('media_files')
    .insert({
      organization_id: finalOrgId,
      campaign_id: params.id,
      deliverable_id: null,
      uploaded_by: user.id,
      filename: filename || url,
      storage_path: url,
      mime_type: null,
      tags: ['campaign_asset'],
      metadata: {
        source: 'campaign_assets_tab',
        kind: 'external_url',
      },
      is_public: false,
    })
    .select()
    .single()

  if (error) {
    console.error('[POST /api/campaigns/[id]/assets] insert link', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data }, { status: 201 })
}
