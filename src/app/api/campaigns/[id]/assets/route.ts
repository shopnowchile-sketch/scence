import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { resolveCampaignAssetAccess } from '@/lib/campaign-asset-access'

type Params = { params: { id: string } }

const BUCKET = 'campaign-assets'
const MAX_FILE_SIZE_BYTES = 4 * 1024 * 1024

function safeFilename(name: string) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160) || 'asset'
}

async function ensureBucket(admin: ReturnType<typeof createAdminClient>) {
  const { data: buckets, error: listError } = await admin.storage.listBuckets()
  if (listError) throw listError
  const exists = buckets?.some(bucket => bucket.name === BUCKET)
  if (!exists) {
    const { error: createError } = await admin.storage.createBucket(BUCKET, {
      public: false,
      fileSizeLimit: 50 * 1024 * 1024,
    })
    if (createError) throw createError
  }
}

async function createCampaignUpload(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  campaignId: string,
  filename: string,
) {
  await ensureBucket(admin)
  const storagePath = `${organizationId}/${campaignId}/${crypto.randomUUID()}-${safeFilename(filename)}`
  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(storagePath)
  if (error || !data) throw error ?? new Error('No se pudo preparar la carga del archivo')
  return { storagePath, token: data.token }
}

async function registerUploadedFile(
  admin: ReturnType<typeof createAdminClient>,
  input: { organizationId: string; campaignId: string; userId: string; filename: string; storagePath: string; mimeType: string | null; sizeBytes: number; assetType: string },
) {
  const { data, error } = await admin
    .from('media_files')
    .insert({
      organization_id: input.organizationId,
      campaign_id: input.campaignId,
      deliverable_id: null,
      uploaded_by: input.userId,
      filename: input.filename,
      storage_path: input.storagePath,
      mime_type: input.mimeType,
      size_bytes: input.sizeBytes,
      tags: ['campaign_asset'],
      metadata: { source: 'campaign_assets_tab', kind: 'uploaded_file', bucket: BUCKET, original_name: input.filename, asset_type: input.assetType },
      is_public: false,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function GET(_request: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { admin, campaign, canView, canViewBrief } = await resolveCampaignAssetAccess(user.id, user.user_metadata, params.id)
  if (!campaign || (!canView && !canViewBrief)) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  let query = admin
    .from('media_files')
    .select('*')
    .eq('campaign_id', params.id)
    .is('deliverable_id', null)
    .order('created_at', { ascending: false })

  // A candidate may access only the current campaign brief. Attachments,
  // product files and any other assets stay restricted to accepted influencers.
  if (!canView) query = query.contains('metadata', { asset_type: 'brief' })

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

  const { admin, campaign, canManage } = await resolveCampaignAssetAccess(user.id, user.user_metadata, params.id)
  if (!campaign || !canManage) return NextResponse.json({ error: 'No tienes permiso para cargar archivos' }, { status: 403 })

  const contentType = request.headers.get('content-type') ?? ''
  // Preferir la org real de la campaña (no la del admin) para que el asset
  // quede tageado correctamente aunque un admin suba archivos a una campaña
  // de una marca con organization_id propia.
  const finalOrgId = campaign.organization_id

  if (contentType.includes('multipart/form-data')) {
    let formData: FormData
    try {
      formData = await request.formData()
    } catch {
      return NextResponse.json({ error: 'No se pudo leer el archivo. Intenta con un PDF, Word o imagen de máximo 4 MB.' }, { status: 422 })
    }
    const file = formData.get('file')
    const customName = String(formData.get('filename') ?? '').trim()
    const assetType = String(formData.get('asset_type') ?? 'asset').trim()

    if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') {
      return NextResponse.json({ error: 'file is required' }, { status: 422 })
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json({ error: 'El archivo supera el máximo de 4 MB.' }, { status: 422 })
    }

    try {
      await ensureBucket(admin)
    } catch (error) {
      console.error('[POST /api/campaigns/[id]/assets] bucket', error)
      return NextResponse.json({ error: 'No fue posible preparar el almacenamiento del brief. Intenta nuevamente.' }, { status: 500 })
    }

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
          asset_type: assetType,
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

  // Los archivos se envían directo a Supabase Storage para no atravesar el
  // límite de body de Vercel. La API solo autoriza y registra el asset.
  if (body.action === 'create_signed_upload') {
    const filename = String(body.filename ?? '').trim()
    const sizeBytes = Number(body.size_bytes ?? 0)
    if (!filename || !Number.isFinite(sizeBytes) || sizeBytes <= 0) return NextResponse.json({ error: 'Archivo inválido' }, { status: 422 })
    if (sizeBytes > MAX_FILE_SIZE_BYTES) return NextResponse.json({ error: 'El archivo supera el máximo de 4 MB.' }, { status: 422 })
    try {
      const upload = await createCampaignUpload(admin, finalOrgId, params.id, filename)
      return NextResponse.json(upload)
    } catch (error) {
      console.error('[POST /api/campaigns/[id]/assets] signed upload', error)
      return NextResponse.json({ error: error instanceof Error ? error.message : 'No fue posible preparar el almacenamiento del brief.' }, { status: 500 })
    }
  }

  if (body.action === 'register_signed_upload') {
    const filename = String(body.filename ?? '').trim()
    const storagePath = String(body.storage_path ?? '').trim()
    const sizeBytes = Number(body.size_bytes ?? 0)
    if (!filename || !storagePath || !Number.isFinite(sizeBytes) || sizeBytes <= 0 || !storagePath.startsWith(`${finalOrgId}/${params.id}/`)) return NextResponse.json({ error: 'Datos de archivo inválidos' }, { status: 422 })
    try {
      const data = await registerUploadedFile(admin, { organizationId: finalOrgId, campaignId: params.id, userId: user.id, filename, storagePath, mimeType: typeof body.mime_type === 'string' ? body.mime_type : null, sizeBytes, assetType: String(body.asset_type ?? 'asset') })
      return NextResponse.json({ data }, { status: 201 })
    } catch (error) {
      console.error('[POST /api/campaigns/[id]/assets] register signed upload', error)
      return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo registrar el brief.' }, { status: 500 })
    }
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
        asset_type: String(body.asset_type ?? 'asset'),
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
