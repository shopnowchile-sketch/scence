-- Reversa de 20261010120000_campaign_locations.sql
-- Elimina SOLO las asociaciones campaña–dirección. No toca public.locations,
-- campaigns ni bookings: el texto histórico nunca se modificó.
-- Antes de ejecutarla, si ya hay filas que importan, respáldalas:
--   CREATE TABLE _bak_campaign_locations AS SELECT * FROM public.campaign_locations;

DROP FUNCTION IF EXISTS public.campaign_locations_set_primary(UUID, UUID);
DROP TABLE IF EXISTS public.campaign_locations;  -- elimina también sus triggers
DROP FUNCTION IF EXISTS public.campaign_locations_promote_primary();
DROP FUNCTION IF EXISTS public.campaign_locations_validate();
