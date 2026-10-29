drop trigger if exists trg_campaign_deliverables_progress on public.campaign_deliverables;
drop function if exists public.campaign_deliverables_progress_follows_status();
-- Restaurar valores previos: update public.campaign_deliverables d set progress = b.progress from ops.backup_deliverable_progress_20261029 b where b.id = d.id;
