-- Reversión de 20261012230000_crm_email_attachments.sql.
-- Solo si el bucket está vacío; si hay archivos, vaciarlos antes desde Storage (no se borran aquí).
alter table public.crm_bulk_send_jobs drop column if exists attachment_path, drop column if exists attachment_name;
delete from storage.buckets where id = 'crm-email-attachments';
