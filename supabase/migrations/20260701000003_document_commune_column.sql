-- La columna `commune` en `influencers` se usaba en código (ranking.ts,
-- /api/influencers/ranking, /api/brand/influencers/ranking) desde antes de
-- esta sesión, pero no existía en ninguna migración versionada — se agregó
-- directo en producción (Supabase Studio) en algún momento. Este archivo solo
-- documenta su existencia real para que el historial del repo quede
-- consistente. Aditivo, sin riesgo (add column if not exists, mismo tipo que
-- ya está en producción: text, nullable, sin default).
alter table influencers
  add column if not exists commune text;
