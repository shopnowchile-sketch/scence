import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const upload = readFileSync(new URL('../src/app/api/crm-leads/attachments/route.ts', import.meta.url), 'utf8')
const attachment = readFileSync(new URL('../src/lib/crm-attachments.ts', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../supabase/migrations/20261012230000_crm_email_attachments.sql', import.meta.url), 'utf8')
const picker = readFileSync(new URL('../src/app/(dashboard)/admin-crm/AttachmentPicker.tsx', import.meta.url), 'utf8')

test('upload exige sesión y rol CRM antes de recibir y guardar el archivo', () => {
  assert.ok(upload.indexOf('auth.getUser()') < upload.indexOf('req.formData()'))
  assert.ok(upload.indexOf('isCrmAdmin(user, admin)') < upload.indexOf('req.formData()'))
  assert.match(upload, /Unauthorized/)
  assert.match(upload, /Forbidden/)
})

test('adjuntos tienen límite de 4 MiB y lista MIME cerrada en servidor y bucket privado', () => {
  assert.match(attachment, /CRM_ATTACHMENT_MAX_BYTES = 4 \* 1024 \* 1024/)
  assert.match(upload, /file\.size > CRM_ATTACHMENT_MAX_BYTES/)
  assert.match(upload, /if \(!CRM_ATTACHMENT_TYPES\[file\.type\]\)/)
  assert.match(upload, /hasAllowedFileSignature\(bytes, file\.type\)/)
  assert.match(attachment, /case 'image\/jpeg':[\s\S]*?starts\(0xff, 0xd8, 0xff\)/)
  assert.match(migration, /'crm-email-attachments', 'crm-email-attachments', false, 4194304/)
  assert.match(migration, /allowed_mime_types/)
  assert.match(picker, /4 \* 1024 \* 1024/)
})

test('ruta de adjunto valida UUID y el bucket se usa por nombre constante privado', () => {
  assert.match(attachment, /CRM_ATTACHMENT_BUCKET = 'crm-email-attachments'/)
  assert.match(attachment, /uploads\\\/[0-9a-f-]\{36\}/)
  assert.match(attachment, /isValidAttachmentPath/)
  assert.match(upload, /upsert: false/)
  assert.doesNotMatch(migration, /public\s*=\s*true/i)
})
