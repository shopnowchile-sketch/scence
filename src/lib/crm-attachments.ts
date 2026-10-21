import { createAdminClient } from '@/lib/supabase/server'

export const CRM_ATTACHMENT_BUCKET = 'crm-email-attachments'
// Vercel limita el body de una request a ~4,5 MB.
export const CRM_ATTACHMENT_MAX_BYTES = 4 * 1024 * 1024

export const CRM_ATTACHMENT_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
}

export function safeAttachmentName(name: string): string {
  const cleaned = name.replace(/[\\/\r\n"]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120)
  return cleaned || 'adjunto'
}

// Solo se aceptan rutas generadas por la subida (uploads/<uuid>/<archivo>).
export function isValidAttachmentPath(path: unknown): path is string {
  return typeof path === 'string' && /^uploads\/[0-9a-f-]{36}\/[^/]{1,150}$/i.test(path)
}

export type LoadedAttachment = { filename: string; content: string }

export async function loadCrmAttachment(
  admin: ReturnType<typeof createAdminClient>,
  path: string,
  filename: string,
): Promise<LoadedAttachment> {
  const { data, error } = await admin.storage.from(CRM_ATTACHMENT_BUCKET).download(path)
  if (error || !data) throw new Error(`No se pudo leer el adjunto: ${error?.message ?? 'archivo no encontrado'}`)
  const buffer = Buffer.from(await data.arrayBuffer())
  if (buffer.length > CRM_ATTACHMENT_MAX_BYTES) throw new Error('El adjunto supera el tamaño máximo')
  return { filename: safeAttachmentName(filename), content: buffer.toString('base64') }
}
