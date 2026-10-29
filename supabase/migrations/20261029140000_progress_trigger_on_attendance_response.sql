-- La confirmación de asistencia fija status=approved desde otro trigger (BEFORE UPDATE OF attendance_response), por lo que el
-- trigger de progress (UPDATE OF status, progress) no se disparaba y la asistencia confirmada quedaba con progress=0.
-- Se amplía la lista de columnas; la función no cambia (approved/published/completed => progress=100).
drop trigger if exists trg_campaign_deliverables_progress on public.campaign_deliverables;
create trigger trg_campaign_deliverables_progress
before insert or update of status, progress, attendance_response on public.campaign_deliverables
for each row execute function public.campaign_deliverables_progress_follows_status();

update public.campaign_deliverables
set progress = 100
where status::text in ('approved', 'published', 'completed') and coalesce(progress, 0) <> 100;
