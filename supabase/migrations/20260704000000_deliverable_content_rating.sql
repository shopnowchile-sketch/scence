-- Rating de contenido (1-5 estrellas) por deliverable, para poder filtrar
-- después por calidad de contenido entregado. Columna nueva y aislada sobre
-- una tabla existente (campaign_deliverables) — no crea tablas ni toca RLS.
alter table public.campaign_deliverables
  add column if not exists content_rating smallint check (content_rating between 1 and 5);
