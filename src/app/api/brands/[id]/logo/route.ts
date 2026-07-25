import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { getOrgId, getUserRole } from '@/lib/supabase/ensureOrg'

const BUCKET = 'brand-logos'
const MAX_BYTES = 5 * 1024 * 1024
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp'])
type Params = { params: { id: string } }

export async function POST(request: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  const role = orgId ? await getUserRole(user.id, orgId, admin) : null
  if (!role?.isAdmin) return NextResponse.json({ error: 'Solo administradores pueden actualizar el logo de una marca' }, { status: 403 })

  const form = await request.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'Selecciona una imagen.' }, { status: 400 })
  if (!ALLOWED.has(file.type)) return NextResponse.json({ error: 'Usa una imagen JPG, PNG o WebP.' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'El logo no puede superar 5 MB.' }, { status: 400 })

  const { data: brand, error } = await admin.from('brands').select('id, organization_id, logo_path').eq('id', params.id).single()
  if (error || !brand) return NextResponse.json({ error: 'Marca no encontrada.' }, { status: 404 })
  const extension = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : 'webp'
  const path = `${brand.id}/logo-${crypto.randomUUID()}.${extension}`

  let { error: uploadError } = await admin.storage.from(BUCKET).upload(path, await file.arrayBuffer(), { contentType: file.type, cacheControl: '3600', upsert: false })
  if (uploadError?.message.toLowerCase().includes('bucket not found')) {
    const { error: bucketError } = await admin.storage.createBucket(BUCKET, { public: true, fileSizeLimit: MAX_BYTES, allowedMimeTypes: Array.from(ALLOWED) })
    if (bucketError && !bucketError.message.toLowerCase().includes('already exists')) return NextResponse.json({ error: bucketError.message }, { status: 500 })
    ;({ error: uploadError } = await admin.storage.from(BUCKET).upload(path, await file.arrayBuffer(), { contentType: file.type, cacheControl: '3600', upsert: false }))
  }
  if (uploadError) return NextResponse.json({ error: `No se pudo subir el logo: ${uploadError.message}` }, { status: 500 })

  const logoUrl = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
  const { error: updateError } = await admin.from('brands').update({ logo_url: logoUrl, logo_path: path, updated_at: new Date().toISOString() }).eq('id', brand.id)
  if (updateError) return NextResponse.json({ error: 'No se pudo guardar el logo.' }, { status: 500 })
  await admin.from('organizations').update({ logo_url: logoUrl, updated_at: new Date().toISOString() }).eq('id', brand.organization_id)
  if (brand.logo_path) await admin.storage.from(BUCKET).remove([brand.logo_path])
  return NextResponse.json({ logo_url: logoUrl })
}
