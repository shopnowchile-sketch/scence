-- Confirmar asistencia NO requiere aprobación (la postulación se aprueba por separado: campaign_influencers.application_status).
-- Invariante en la base: en un entregable event_attendance con respuesta, el status deriva de ella
-- (confirmed → approved, declined → rejected) y nunca queda 'in_review'. Cierra los estados incoherentes que dejaban
-- cambios manuales del equipo (confirmación registrada sin status, rechazos/aprobaciones sobre una asistencia).
create schema if not exists ops;
create table if not exists ops.backup_attendance_status_20261029 as
  select id, status, attendance_response from public.campaign_deliverables where type = 'event_attendance';

create or replace function public.campaign_deliverables_attendance_status()
returns trigger language plpgsql as $$
begin
  if new.type = 'event_attendance' then
    if new.attendance_response = 'confirmed' then new.status := 'approved';
    elsif new.attendance_response = 'declined' then new.status := 'rejected';
    elsif new.status = 'in_review' then new.status := 'pending';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_campaign_deliverables_attendance_status on public.campaign_deliverables;
create trigger trg_campaign_deliverables_attendance_status
before insert or update of status, attendance_response, type on public.campaign_deliverables
for each row execute function public.campaign_deliverables_attendance_status();

-- Normaliza las filas existentes (solo el campo derivado status; la respuesta de la influencer no se toca).
update public.campaign_deliverables
set status = (case attendance_response when 'confirmed' then 'approved' else 'rejected' end)::public.deliverable_status
where type = 'event_attendance'
  and attendance_response in ('confirmed', 'declined')
  and status::text is distinct from (case attendance_response when 'confirmed' then 'approved' else 'rejected' end);

update public.campaign_deliverables
set status = 'pending'
where type = 'event_attendance' and attendance_response is null and status::text = 'in_review';
