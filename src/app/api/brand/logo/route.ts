import { NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { resolveBrandAccess } from '@/lib/supabase/ensureOrg'

const BUCKET = 'brand-logos'
const MAX_BYTES = 5 * 1024 * 1024
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

export async function POST(request: Request) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autorizada' }, { status: 401 })
  const access = await resolveBrandAccess(user.id)
  if (!access || (!access.isOwner && access.role !== 'brand_manager')) return NextResponse.json({ error: 'No tienes permiso para cambiar el logo' }, { status: 403 })
  const form = await request.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'Selecciona una imagen.' }, { status: 400 })
  if (!ALLOWED_TYPES.has(file.type)) return NextResponse.json({ error: 'Formato no permitido. Usa JPG, PNG o WebP.' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'El logo debe pesar menos de 5 MB.' }, { status: 400 })

  const admin = createAdminClient()
  const { data: brand, error: brandError } = await admin.from('brands').select('id, organization_id, logo_url, logo_path').eq('id', access.brandId).single()
  if (brandError || !brand) return NextResponse.json({ error: 'Marca no encontrada.' }, { status: 404 })
  const extension = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : 'webp'
  const path = `${brand.id}/logo-${crypto.randomUUID()}.${extension}`
  const upload = async () => admin.storage.from(BUCKET).upload(path, await file.arrayBuffer(), { contentType: file.type, cacheControl: '3600', upsert: false })
  let { error: uploadError } = await upload()
  if (uploadError?.message.toLowerCase().includes('bucket not found')) {
    const { error } = await admin.storage.createBucket(BUCKET, { public: true, fileSizeLimit: MAX_BYTES, allowedMimeTypes: Array.from(ALLOWED_TYPES) })
    if (error && !error.message.toLowerCase().includes('already exists')) return NextResponse.json({ error: `No se pudo preparar el espacio de logos: ${error.message}` }, { status: 500 })
    ;({ error: uploadError } = await upload())
  }
  if (uploadError) return NextResponse.json({ error: `No se pudo subir el logo: ${uploadError.message}` }, { status: 500 })

  const logoUrl = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
  const { error: updateError } = await admin.from('brands').update({ logo_url: logoUrl, logo_path: path, updated_at: new Date().toISOString() }).eq('id', brand.id)
  if (updateError) { await admin.storage.from(BUCKET).remove([path]); return NextResponse.json({ error: 'No se pudo guardar el logo.' }, { status: 500 }) }
  await admin.from('organizations').update({ logo_url: logoUrl, updated_at: new Date().toISOString() }).eq('id', brand.organization_id)
  if (brand.logo_path) await admin.storage.from(BUCKET).remove([brand.logo_path])
  return NextResponse.json({ logo_url: logoUrl })
}
