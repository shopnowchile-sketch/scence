-- Reversión de 20261012230000_crm_email_attachments.sql.
-- Quita las columnas. El bucket NO se borra por SQL (Supabase lo impide: storage.protect_delete); si hace falta,
-- vaciarlo y eliminarlo desde el panel de Storage o con la API de Storage. Dejarlo es inofensivo (privado, sin código que lo use).
alter table public.crm_bulk_send_jobs drop column if exists attachment_path, drop column if exists attachment_name;
