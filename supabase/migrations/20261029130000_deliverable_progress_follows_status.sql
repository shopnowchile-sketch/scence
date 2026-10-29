-- campaign_deliverables.progress quedaba en 0 aunque el entregable estuviera aprobado (292 de 294 aprobados en PROD):
-- ninguna ruta lo actualizaba al aprobar/publicar y ningún KPI lo lee (el porcentaje se deriva de isDeliverableComplete).
-- Invariante en la base: approved/published/completed => progress = 100. No toca status, contenido, historial ni aprobaciones.
create schema if not exists ops;
create table if not exists ops.backup_deliverable_progress_20261029 as
  select id, status, progress from public.campaign_deliverables;

create or replace function public.campaign_deliverables_progress_follows_status()
returns trigger language plpgsql as $$
begin
  if new.status::text in ('approved', 'published', 'completed') then
    new.progress := 100;
  end if;
  return new;
end $$;

drop trigger if exists trg_campaign_deliverables_progress on public.campaign_deliverables;
create trigger trg_campaign_deliverables_progress
before insert or update of status, progress on public.campaign_deliverables
for each row execute function public.campaign_deliverables_progress_follows_status();

update public.campaign_deliverables
set progress = 100
where status::text in ('approved', 'published', 'completed') and coalesce(progress, 0) <> 100;
