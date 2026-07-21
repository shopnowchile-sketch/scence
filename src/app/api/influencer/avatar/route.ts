import { NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'

const BUCKET = 'influencer-avatars'
const MAX_BYTES = 5 * 1024 * 1024
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

// POST /api/influencer/avatar
// Upload server-side: the browser never receives the storage service key.
export async function POST(request: Request) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'No autorizada' }, { status: 401 })

  const formData = await request.formData()
  const file = formData.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'Selecciona una imagen.' }, { status: 400 })
  if (!ALLOWED_TYPES.has(file.type)) return NextResponse.json({ error: 'Formato no permitido. Usa JPG, PNG o WebP.' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'La imagen debe pesar menos de 5 MB.' }, { status: 400 })

  const admin = createAdminClient()
  const { data: influencer, error: profileError } = await admin
    .from('influencers')
    .select('id, avatar_url')
    .eq('user_id', user.id)
    .single()
  if (profileError || !influencer) return NextResponse.json({ error: 'Perfil de influencer no encontrado.' }, { status: 404 })

  const extension = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : 'webp'
  const path = `${influencer.id}/profile-${crypto.randomUUID()}.${extension}`
  const bytes = await file.arrayBuffer()
  const uploadOptions = {
    contentType: file.type,
    cacheControl: '3600',
    upsert: false,
  }
  let { error: uploadError } = await admin.storage.from(BUCKET).upload(path, bytes, uploadOptions)

  // El bucket también se declara en la migración, pero esta recuperación hace
  // que el primer upload siga funcionando si una instalación aún no aplicó las
  // migraciones de Storage. Se ejecuta con la service role y solo después de
  // verificar que la solicitud pertenece a la propia influencer.
  if (uploadError?.message.toLowerCase().includes('bucket not found')) {
    const { error: createBucketError } = await admin.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: MAX_BYTES,
      allowedMimeTypes: Array.from(ALLOWED_TYPES),
    })
    if (createBucketError && !createBucketError.message.toLowerCase().includes('already exists')) {
      return NextResponse.json({ error: `No se pudo preparar el espacio de fotos: ${createBucketError.message}` }, { status: 500 })
    }
    ;({ error: uploadError } = await admin.storage.from(BUCKET).upload(path, bytes, uploadOptions))
  }
  if (uploadError) return NextResponse.json({ error: `No se pudo subir la imagen: ${uploadError.message}` }, { status: 500 })

  const { data: publicData } = admin.storage.from(BUCKET).getPublicUrl(path)
  const avatar_url = publicData.publicUrl
  const { error: updateError } = await admin
    .from('influencers')
    .update({ avatar_url })
    .eq('id', influencer.id)
  if (updateError) {
    await admin.storage.from(BUCKET).remove([path])
    return NextResponse.json({ error: 'No se pudo guardar la foto de perfil.' }, { status: 500 })
  }

  // Only delete a previous image that was uploaded by this feature. External
  // Instagram URLs are intentionally preserved.
  const oldPathPrefix = `/storage/v1/object/public/${BUCKET}/`
  const oldUrl = influencer.avatar_url ?? ''
  const index = oldUrl.indexOf(oldPathPrefix)
  if (index >= 0) {
    const oldPath = oldUrl.slice(index + oldPathPrefix.length)
    if (oldPath.startsWith(`${influencer.id}/`)) await admin.storage.from(BUCKET).remove([oldPath])
  }

  return NextResponse.json({ avatar_url })
}
