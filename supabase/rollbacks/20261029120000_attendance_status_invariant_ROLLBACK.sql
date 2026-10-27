drop trigger if exists trg_campaign_deliverables_attendance_status on public.campaign_deliverables;
drop function if exists public.campaign_deliverables_attendance_status();
update public.campaign_deliverables d set status = b.status
from ops.backup_attendance_status_20261029 b where b.id = d.id;
