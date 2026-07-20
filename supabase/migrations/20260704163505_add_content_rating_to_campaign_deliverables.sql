alter table public.campaign_deliverables
  add column if not exists content_rating smallint check (content_rating between 1 and 5);;
