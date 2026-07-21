alter table public.campaign_deliverables
  add column if not exists scheduled_at timestamptz,
  add column if not exists sequence_number integer;
alter table public.campaign_deliverables
  drop constraint if exists campaign_deliverables_description_length;
alter table public.campaign_deliverables
  add constraint campaign_deliverables_description_length
  check (description is null or char_length(description) <= 3000) not valid;
comment on column public.campaign_deliverables.due_date is
  'Fecha límite para entregar el contenido a revisión.';
comment on column public.campaign_deliverables.scheduled_at is
  'Fecha y hora programadas para publicar el contenido.';
comment on column public.campaign_deliverables.sequence_number is
  'Posición de esta pieza dentro del grupo de Reel, Story u otro tipo.';
