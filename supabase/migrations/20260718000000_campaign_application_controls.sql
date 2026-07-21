-- Controles independientes para postulaciones de campañas públicas.
-- No cambia el estado operativo de la campaña ni elimina postulaciones previas.

alter table public.campaigns
  add column if not exists application_deadline timestamptz,
  add column if not exists max_influencers integer,
  add column if not exists applications_closed_at timestamptz;
alter table public.campaign_influencers
  add column if not exists application_status text not null default 'pending';
-- application_deadline ya existe en producción. Se normaliza a timestamptz
-- para permitir una hora exacta de cierre; los valores DATE existentes quedan
-- representados a medianoche UTC, sin pérdida del día almacenado.
alter table public.campaigns
  alter column application_deadline type timestamptz
  using application_deadline::timestamptz;
create index if not exists idx_campaigns_open_application_controls
  on public.campaigns (visibility, status, application_deadline, applications_closed_at)
  where visibility = 'open';
-- Última barrera contra dos aprobaciones simultáneas: serializa por campaña y
-- evita superar max_influencers incluso si dos solicitudes llegan a la vez.
create or replace function public.enforce_campaign_influencer_capacity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_max integer;
  v_accepted integer;
begin
  if new.application_status is distinct from 'accepted'
     or (tg_op = 'UPDATE' and old.application_status is not distinct from 'accepted') then
    return new;
  end if;

  select max_influencers into v_max
  from public.campaigns
  where id = new.campaign_id
  for update;

  if v_max is null or v_max <= 0 then
    return new;
  end if;

  select count(*) into v_accepted
  from public.campaign_influencers
  where campaign_id = new.campaign_id
    and application_status = 'accepted'
    and id <> new.id;

  if v_accepted >= v_max then
    raise exception 'Los cupos de esta campaña están completos'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;
drop trigger if exists trg_enforce_campaign_influencer_capacity
  on public.campaign_influencers;
create trigger trg_enforce_campaign_influencer_capacity
before insert or update of application_status on public.campaign_influencers
for each row execute function public.enforce_campaign_influencer_capacity();
