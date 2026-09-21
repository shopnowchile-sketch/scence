import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { getOrgId, getUserRole } from '@/lib/supabase/ensureOrg'

const BUCKET = 'influencer-private-documents'

async function requireAdmin() {
  const supabase = createServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  const { isAdmin } = orgId ? await getUserRole(user.id, orgId, admin) : { isAdmin: false }
  if (!isAdmin) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { admin, orgId }
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const documentId = request.nextUrl.searchParams.get('id')
  if (documentId) {
    const { data: document, error } = await auth.admin
      .from('influencer_documents')
      .select('id, influencer_id, storage_path, original_filename, mime_type')
      .eq('id', documentId)
      .maybeSingle()
    if (error || !document) return NextResponse.json({ error: 'Documento no encontrado.' }, { status: 404 })

    const { data: influencer } = await auth.admin
      .from('influencers')
      .select('id, organization_id')
      .eq('id', document.influencer_id)
      .maybeSingle()
    if (!influencer || influencer.organization_id !== auth.orgId) return NextResponse.json({ error: 'Documento no encontrado.' }, { status: 404 })

    const { data, error: signedError } = await auth.admin.storage
      .from(BUCKET)
      .createSignedUrl(document.storage_path, 60 * 5)
    if (signedError || !data?.signedUrl) return NextResponse.json({ error: 'No se pudo abrir el documento.' }, { status: 500 })
    return NextResponse.json({ url: data.signedUrl, original_filename: document.original_filename, mime_type: document.mime_type })
  }

  const influencerId = request.nextUrl.searchParams.get('influencer_id')
  if (!influencerId) return NextResponse.json({ error: 'influencer_id es requerido.' }, { status: 422 })

  const { data: influencer } = await auth.admin
    .from('influencers')
    .select('id, organization_id')
    .eq('id', influencerId)
    .maybeSingle()
  if (!influencer || influencer.organization_id !== auth.orgId) return NextResponse.json({ error: 'Influencer no encontrada.' }, { status: 404 })

  const { data, error } = await auth.admin
    .from('influencer_documents')
    .select('id, document_type, title, original_filename, mime_type, file_size, visibility, created_at')
    .eq('influencer_id', influencerId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: 'No se pudieron cargar los documentos.' }, { status: 500 })
  return NextResponse.json({ data: data ?? [] })
}
