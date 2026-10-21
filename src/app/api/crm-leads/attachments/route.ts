import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { isCrmAdmin } from '@/lib/crm-auth'
import {
  CRM_ATTACHMENT_BUCKET, CRM_ATTACHMENT_MAX_BYTES, CRM_ATTACHMENT_TYPES, hasAllowedFileSignature, safeAttachmentName,
} from '@/lib/crm-attachments'

// POST /api/crm-leads/attachments — sube un archivo (multipart, campo "file")
// al bucket privado y devuelve { path, name, size } para usarlo en el envío.
export async function POST(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  if (!(await isCrmAdmin(user, admin))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'Falta el archivo' }, { status: 422 })
  if (file.size === 0) return NextResponse.json({ error: 'El archivo está vacío' }, { status: 422 })
  if (file.size > CRM_ATTACHMENT_MAX_BYTES) {
    return NextResponse.json({ error: 'El archivo supera los 4 MB' }, { status: 413 })
  }
  if (!CRM_ATTACHMENT_TYPES[file.type]) {
    return NextResponse.json({ error: 'Formato no permitido. Usa PDF, imagen (JPG/PNG/WEBP), Word, Excel o PowerPoint.' }, { status: 415 })
  }

  const bytes = Buffer.from(await file.arrayBuffer())
  if (!hasAllowedFileSignature(bytes, file.type)) {
    return NextResponse.json({ error: 'El contenido del archivo no coincide con el formato declarado.' }, { status: 415 })
  }

  const name = safeAttachmentName(file.name)
  const path = `uploads/${randomUUID()}/${name.replace(/[^\w.\- ]/g, '_')}`
  const { error } = await admin.storage
    .from(CRM_ATTACHMENT_BUCKET)
    .upload(path, bytes, { contentType: file.type, upsert: false })
  if (error) {
    console.error('[crm attachments] upload', error)
    return NextResponse.json({ error: 'No se pudo subir el archivo' }, { status: 500 })
  }
  return NextResponse.json({ path, name, size: file.size })
}
