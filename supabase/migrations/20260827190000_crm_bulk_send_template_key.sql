alter table public.crm_bulk_send_jobs
  add column if not exists template_key text not null default 'crm_intro';

comment on column public.crm_bulk_send_jobs.template_key is
  'Clave del catálogo central de emails usada para este envío masivo.';
