-- Métricas reales de publicación por deliverable (views/likes/comments desde
-- Apify, vía link published_url/content_url). Reutiliza la columna existente
-- `performance JSONB` (ya en el schema inicial, sin uso hasta ahora) para
-- guardar { views, likes, comments } — shares/saves/reach/impressions NO se
-- guardan porque ningún actor de Apify los entrega de forma confiable hoy
-- (quedan fuera del JSONB, no se inventan).
--
-- Estas 3 columnas nuevas son metadata de la sincronización, no las métricas
-- en sí (esas van en `performance`, ya existente):
--   metrics_updated_at → cuándo fue la última sync real
--   metrics_provider   → qué integración las trajo (hoy: 'apify')
--   engagement_rate    → calculado por nosotros (likes+comments)/views o
--                        /seguidores del influencer — SIEMPRE etiquetado como
--                        "calculado" en la UI, nunca como dato real de Instagram.
--
-- Columna nueva y aislada sobre tabla existente (campaign_deliverables) — no
-- crea tablas, no toca RLS ni auth.
alter table public.campaign_deliverables
  add column if not exists metrics_updated_at timestamptz,
  add column if not exists metrics_provider text,
  add column if not exists engagement_rate numeric(6,2);
