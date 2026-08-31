import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'

const BUCKET = 'influencer-private-documents'
const MAX_BYTES = 10 * 1024 * 1024
const ALLOWED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
const DOCUMENT_TYPES = new Set(['portfolio', 'identity', 'other'])

async function context() {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data: influencer } = await admin.from('influencers').select('id, is_active').eq('user_id', user.id).maybeSingle()
  return influencer?.is_active ? { admin, influencer } : null
}

export async function GET() {
  const ctx = await context()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data, error } = await ctx.admin.from('influencer_documents').select('id, document_type, title, original_filename, mime_type, file_size, created_at').eq('influencer_id', ctx.influencer.id).order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: 'No se pudieron consultar tus documentos.' }, { status: 500 })
  return NextResponse.json({ data: data ?? [] })
}

export async function POST(request: NextRequest) {
  const ctx = await context()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const form = await request.formData()
  const file = form.get('file'), documentType = String(form.get('document_type') ?? ''), title = String(form.get('title') ?? '').trim()
  if (!(file instanceof File)) return NextResponse.json({ error: 'Selecciona un archivo.' }, { status: 422 })
  if (!DOCUMENT_TYPES.has(documentType)) return NextResponse.json({ error: 'Tipo de documento inválido.' }, { status: 422 })
  if (!title || title.length > 120) return NextResponse.json({ error: 'Ingresa un título válido.' }, { status: 422 })
  if (!ALLOWED_TYPES.has(file.type)) return NextResponse.json({ error: 'Formato no permitido. Usa PDF, JPG, PNG o WebP.' }, { status: 422 })
  if (file.size <= 0 || file.size > MAX_BYTES) return NextResponse.json({ error: 'El archivo debe pesar menos de 10 MB.' }, { status: 422 })
  const extension = file.type === 'application/pdf' ? 'pdf' : file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : 'webp'
  const path = `${ctx.influencer.id}/${crypto.randomUUID()}.${extension}`
  const { error: uploadError } = await ctx.admin.storage.from(BUCKET).upload(path, await file.arrayBuffer(), { contentType: file.type, upsert: false })
  if (uploadError) return NextResponse.json({ error: `No se pudo subir el documento: ${uploadError.message}` }, { status: 500 })
  const { data, error } = await ctx.admin.from('influencer_documents').insert({ influencer_id: ctx.influencer.id, document_type: documentType, title, original_filename: file.name.slice(0, 255), storage_path: path, mime_type: file.type, file_size: file.size }).select('id, document_type, title, original_filename, mime_type, file_size, created_at').single()
  if (error) { await ctx.admin.storage.from(BUCKET).remove([path]); return NextResponse.json({ error: 'No se pudo guardar el documento.' }, { status: 500 }) }
  return NextResponse.json({ data }, { status: 201 })
}
