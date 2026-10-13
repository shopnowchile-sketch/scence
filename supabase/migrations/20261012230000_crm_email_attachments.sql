-- Adjuntos para emails del CRM (individual y masivo).
-- Bucket privado: solo el servidor (service role) lee y escribe.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'crm-email-attachments', 'crm-email-attachments', false, 4194304,
  array[
    'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- El job masivo recuerda qué archivo adjuntar en cada tanda.
alter table public.crm_bulk_send_jobs
  add column if not exists attachment_path text,
  add column if not exists attachment_name text;
