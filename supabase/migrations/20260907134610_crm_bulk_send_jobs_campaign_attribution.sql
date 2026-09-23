-- Atribución de campaña para envíos masivos del CRM.
-- Aditivo y nullable: no altera filas existentes ni el flujo actual de bulk-send.
alter table public.crm_bulk_send_jobs
  add column if not exists campaign_id uuid references public.campaigns(id) on delete set null,
  add column if not exists campaign_snapshot jsonb;

create index if not exists crm_bulk_send_jobs_campaign_id_idx
  on public.crm_bulk_send_jobs (campaign_id)
  where campaign_id is not null;

comment on column public.crm_bulk_send_jobs.campaign_id is
  'Campaña asociada al envío (opcional). Alimenta las variables del template campaign_creator_invitation.';
comment on column public.crm_bulk_send_jobs.campaign_snapshot is
  'Copia congelada de los datos de la campaña al momento de crear el job, para que el envío no cambie si la campaña se edita después.';
