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

export function hasAllowedFileSignature(bytes: Uint8Array, mimeType: string): boolean {
  const starts = (...signature: number[]) => signature.every((value, index) => bytes[index] === value)
  const ascii = (start: number, end: number) => {
    let value = ''
    for (let index = start; index < end && index < bytes.length; index += 1) value += String.fromCharCode(bytes[index])
    return value
  }
  const ascii = (start: number, end: number) => {
    let value = ''
    for (let index = start; index < end && index < bytes.length; index += 1) value += String.fromCharCode(bytes[index])
    return value
  }
  switch (mimeType) {
    case 'application/pdf':
      return bytes.length >= 5 && ascii(0, 5) === '%PDF-'
    case 'image/jpeg':
      return starts(0xff, 0xd8, 0xff)
    case 'image/png':
      return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
    case 'image/webp':
      return bytes.length >= 12 && ascii(0, 4) === 'RIFF'
        && ascii(8, 12) === 'WEBP'
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
      // OOXML containers are ZIP files; MIME allowlisting is also enforced.
      return starts(0x50, 0x4b, 0x03, 0x04)
    default:
      return false
  }
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
