alter table public.campaign_deliverables
  add column if not exists metrics_updated_at timestamptz,
  add column if not exists metrics_provider text,
  add column if not exists engagement_rate numeric(6,2);
;
