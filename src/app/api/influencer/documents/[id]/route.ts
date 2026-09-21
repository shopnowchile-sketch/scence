import { NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'

const BUCKET = 'influencer-private-documents'
type Params = { params: { id: string } }

async function documentContext(id: string) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data: influencer } = await admin.from('influencers').select('id').eq('user_id', user.id).maybeSingle()
  if (!influencer) return null
  const { data: document } = await admin.from('influencer_documents').select('id, storage_path, original_filename, visibility').eq('id', id).eq('influencer_id', influencer.id).maybeSingle()
  return document ? { admin, document } : null
}

export async function GET(_request: Request, { params }: Params) {
  const ctx = await documentContext(params.id)
  if (!ctx) return NextResponse.json({ error: 'Documento no encontrado.' }, { status: 404 })
  const { data, error } = await ctx.admin.storage.from(BUCKET).createSignedUrl(ctx.document.storage_path, 60 * 5, { download: ctx.document.original_filename })
  if (error || !data?.signedUrl) return NextResponse.json({ error: 'No se pudo abrir el documento.' }, { status: 500 })
  return NextResponse.json({ url: data.signedUrl })
}

export async function PATCH(request: Request, { params }: Params) {
  const ctx = await documentContext(params.id)
  if (!ctx) return NextResponse.json({ error: 'Documento no encontrado.' }, { status: 404 })
  let body: { visibility?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 }) }
  if (body.visibility !== 'private' && body.visibility !== 'approved_brands') {
    return NextResponse.json({ error: 'Visibilidad inválida.' }, { status: 422 })
  }
  const { data, error } = await ctx.admin.from('influencer_documents').update({ visibility: body.visibility, updated_at: new Date().toISOString() }).eq('id', ctx.document.id).select('id, visibility').single()
  if (error) return NextResponse.json({ error: 'No se pudo actualizar la visibilidad.' }, { status: 500 })
  return NextResponse.json({ data })
}

export async function DELETE(_request: Request, { params }: Params) {
  const ctx = await documentContext(params.id)
  if (!ctx) return NextResponse.json({ error: 'Documento no encontrado.' }, { status: 404 })
  const { error: storageError } = await ctx.admin.storage.from(BUCKET).remove([ctx.document.storage_path])
  if (storageError) return NextResponse.json({ error: 'No se pudo eliminar el archivo.' }, { status: 500 })
  const { error } = await ctx.admin.from('influencer_documents').delete().eq('id', ctx.document.id)
  if (error) return NextResponse.json({ error: 'No se pudo eliminar el documento.' }, { status: 500 })
  return NextResponse.json({ deleted: true })
}
