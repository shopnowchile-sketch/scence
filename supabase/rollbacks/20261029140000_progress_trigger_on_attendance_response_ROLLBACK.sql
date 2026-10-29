drop trigger if exists trg_campaign_deliverables_progress on public.campaign_deliverables;
create trigger trg_campaign_deliverables_progress
before insert or update of status, progress on public.campaign_deliverables
for each row execute function public.campaign_deliverables_progress_follows_status();
