-- ============================================================================
-- Locations — eliminar columnas geográficas duplicadas (DESTRUCTIVA)
--
-- city / region / country en `locations` quedan reemplazadas por la jerarquía
-- (parent_id). Mantenerlas sería una segunda fuente de verdad.
--
-- ⚠️ Vive en supabase/pending/ a propósito: un `db push` NO debe aplicarla junto
-- con las otras dos. Moverla a supabase/migrations/ solo cuando el código nuevo
-- esté desplegado en producción.
--
-- Aplicar SOLO después de:
--   1) 20261004230000_locations_hierarchy y 20261004230100_locations_seed_chile
--   2) desplegar el código que ya no lee estas columnas (/api/locations + UI).
--
-- Respaldo previo en ops.locations_legacy_geo_20261004 (mismo patrón que
-- ops.tenant_split_20260923) para que el rollback restaure los valores.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS ops;

CREATE TABLE IF NOT EXISTS ops.locations_legacy_geo_20261004 AS
SELECT id, city, region, country, now() AS backed_up_at
FROM public.locations
WHERE city IS NOT NULL OR region IS NOT NULL OR country IS NOT NULL;

REVOKE ALL ON ops.locations_legacy_geo_20261004 FROM PUBLIC, anon, authenticated;

ALTER TABLE public.locations
  DROP COLUMN IF EXISTS city,
  DROP COLUMN IF EXISTS region,
  DROP COLUMN IF EXISTS country;
